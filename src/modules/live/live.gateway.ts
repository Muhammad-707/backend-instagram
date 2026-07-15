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
  ) {}

  afterInit(server: Server): void {
    this.bridge.bind(server);
    this.logger.log('Socket.IO /live готов');
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET', 'change_me_access_secret'),
      });
      client.userId = payload.sub;
      await client.join(liveUserRoom(payload.sub));
    } catch {
      client.disconnect(true);
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
