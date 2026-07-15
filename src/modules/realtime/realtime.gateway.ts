import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { PresenceService } from './presence.service';
import { RealtimeService, userRoom } from './realtime.service';

interface AccessPayload {
  sub: string;
  userName: string;
}

interface AuthedSocket extends Socket {
  userId?: string;
}

/**
 * Socket.IO namespace `/rt`. Аутентификация — тем же access-JWT, что и REST:
 * токен в `auth.token` при подключении. Каждый юзер сидит в комнате user:<id>.
 *
 * Presence: при connect — online + presence:update(online) участникам; heartbeat
 * каждые 30с продлевает ключ; при disconnect — offline + lastSeenAt.
 *
 * Звонки: сервер только ПЕРЕДАЁТ SDP/ICE между участниками (call:offer/answer/ice/end),
 * само медиа идёт p2p, мы его не трогаем.
 */
@WebSocketGateway({
  namespace: '/rt',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    // Отдаём сервер в RealtimeService — теперь REST-слой может слать события.
    this.realtime.bind(server);
    this.logger.log('Socket.IO /rt готов');
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET', 'change_me_access_secret'),
      });
    } catch {
      client.disconnect(true);
      return;
    }

    client.userId = payload.sub;
    await client.join(userRoom(payload.sub));
    await this.presence.touch(payload.sub);
    await this.prisma.presence
      .upsert({
        where: { userId: payload.sub },
        create: { userId: payload.sub, isOnline: true, lastSeenAt: new Date() },
        update: { isOnline: true, lastSeenAt: new Date() },
      })
      .catch(() => undefined);

    await this.broadcastPresence(payload.sub, true);
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    if (!client.userId) return;
    // adapter.rooms берём через namespace самого сокета (client.nsp) — там корректный тип,
    // в отличие от this.server.adapter (перегруженная функция). Остались другие сокеты — юзер онлайн.
    const room = client.nsp.adapter.rooms.get(userRoom(client.userId));
    if (room && room.size > 0) return;

    await this.presence.goOffline(client.userId);
    await this.broadcastPresence(client.userId, false);
  }

  // ─────────────── heartbeat ───────────────

  @SubscribeMessage('heartbeat')
  async onHeartbeat(client: AuthedSocket): Promise<void> {
    if (client.userId) await this.presence.touch(client.userId);
  }

  // ─────────────── typing ───────────────

  @SubscribeMessage('typing:start')
  async onTypingStart(client: AuthedSocket, chatId: number): Promise<void> {
    await this.relayTyping(client, chatId, true);
  }

  @SubscribeMessage('typing:stop')
  async onTypingStop(client: AuthedSocket, chatId: number): Promise<void> {
    await this.relayTyping(client, chatId, false);
  }

  private async relayTyping(client: AuthedSocket, chatId: number, typing: boolean): Promise<void> {
    if (!client.userId) return;
    const peers = await this.chatPeers(chatId, client.userId);
    this.realtime.emitToUsers(peers, typing ? 'typing:start' : 'typing:stop', {
      chatId,
      userId: client.userId,
    });
  }

  // ─────────────── звонки (сигналинг) ───────────────

  @SubscribeMessage('call:offer')
  async onCallOffer(client: AuthedSocket, data: { chatId: number; sdp: unknown }): Promise<void> {
    await this.relayCall(client, data.chatId, 'call:offer', { sdp: data.sdp });
  }

  @SubscribeMessage('call:answer')
  async onCallAnswer(client: AuthedSocket, data: { chatId: number; sdp: unknown }): Promise<void> {
    await this.relayCall(client, data.chatId, 'call:answer', { sdp: data.sdp });
  }

  @SubscribeMessage('call:ice')
  async onCallIce(
    client: AuthedSocket,
    data: { chatId: number; candidate: unknown },
  ): Promise<void> {
    await this.relayCall(client, data.chatId, 'call:ice', { candidate: data.candidate });
  }

  @SubscribeMessage('call:end')
  async onCallEnd(client: AuthedSocket, data: { chatId: number }): Promise<void> {
    await this.relayCall(client, data.chatId, 'call:end', {});
  }

  /** Пробрасываем сигнал собеседникам; сервер SDP/ICE не разбирает. */
  private async relayCall(
    client: AuthedSocket,
    chatId: number,
    event: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    if (!client.userId) return;
    const peers = await this.chatPeers(chatId, client.userId);
    this.realtime.emitToUsers(peers, event, { chatId, fromUserId: client.userId, ...extra });
  }

  // ─────────────── helpers ───────────────

  private async broadcastPresence(userId: string, online: boolean): Promise<void> {
    // Сообщаем тем, у кого есть общий чат с этим юзером.
    const chats = await this.prisma.chatParticipant.findMany({
      where: { userId },
      select: { chatId: true },
    });
    const chatIds = chats.map((c) => c.chatId);
    const peers = await this.prisma.chatParticipant.findMany({
      where: { chatId: { in: chatIds }, userId: { not: userId } },
      select: { userId: true },
      distinct: ['userId'],
    });
    this.realtime.emitToUsers(
      peers.map((p) => p.userId),
      'presence:update',
      { userId, isOnline: online, lastSeenAt: new Date() },
    );
  }

  private async chatPeers(chatId: number, exceptUserId: string): Promise<string[]> {
    const parts = await this.prisma.chatParticipant.findMany({
      where: { chatId, userId: { not: exceptUserId } },
      select: { userId: true },
    });
    return parts.map((p) => p.userId);
  }

  private extractToken(client: AuthedSocket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token.replace(/^Bearer\s+/i, '');
    const header = client.handshake.headers.authorization;
    if (header) return header.replace(/^Bearer\s+/i, '');
    return null;
  }
}
