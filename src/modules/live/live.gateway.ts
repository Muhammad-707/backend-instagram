import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketService } from '../socket/socket.service';
import { LiveRealtimeService, liveRoom, liveUserRoom } from './live-realtime.service';

interface AccessPayload {
  sub: string;
}

interface AuthedSocket extends Socket {
  userId?: string;
}

/**
 * Socket.IO namespace `/live`. Аутентификация тем же access-JWT (auth.token).
 * Каждый клиент сидит в liveuser:<id> (личные события), а на просмотр эфира
 * подписывается через `live:subscribe` → комната live:<liveId>.
 */
@WebSocketGateway({
  namespace: '/live',
  cors: { origin: true, credentials: true },
})
export class LiveGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(LiveGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly bridge: LiveRealtimeService,
    private readonly socket: SocketService,
  ) {}

  afterInit(server: Server): void {
    this.bridge.bind(server);
    this.logger.log('Socket.IO /live готов');
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    const userId = await this.authenticate(client);
    if (!userId) {
      client.disconnect(true);
      return;
    }
    client.userId = userId;
    await client.join(liveUserRoom(userId));
  }

  /**
   * Как и в /rt: основной путь для браузера — одноразовый `auth.ticket`
   * (access-токен лежит в httpOnly-куке и в cross-origin сокет не попадёт),
   * `auth.token` оставлен для клиентов с токеном на руках.
   */
  private async authenticate(client: AuthedSocket): Promise<string | null> {
    const ticket = (client.handshake.auth as { ticket?: string } | undefined)?.ticket;
    if (ticket) return this.socket.burn(ticket);

    const token = this.extractToken(client);
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET', 'change_me_access_secret'),
      });
      return payload.sub;
    } catch {
      return null;
    }
  }

  @SubscribeMessage('live:subscribe')
  async onSubscribe(client: AuthedSocket, liveId: string): Promise<void> {
    if (client.userId && typeof liveId === 'string') await client.join(liveRoom(liveId));
  }

  @SubscribeMessage('live:unsubscribe')
  async onUnsubscribe(client: AuthedSocket, liveId: string): Promise<void> {
    if (typeof liveId === 'string') await client.leave(liveRoom(liveId));
  }

  private extractToken(client: AuthedSocket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token.replace(/^Bearer\s+/i, '');
    const header = client.handshake.headers.authorization;
    if (header) return header.replace(/^Bearer\s+/i, '');
    return null;
  }
}
