import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

/**
 * Тонкая обёртка над livekit-server-sdk.
 * publisher-токен — хосту и принятому гостю (могут вещать); subscriber — зрителям.
 * Медиа идёт через сам LiveKit (SFU), наш backend только раздаёт токены и закрывает комнату.
 */
@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly wsUrl: string;
  private readonly roomClient: RoomServiceClient;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('LIVEKIT_API_KEY', 'devkey');
    this.apiSecret = config.get<string>('LIVEKIT_API_SECRET', 'devsecret');
    this.wsUrl = config.get<string>('LIVEKIT_URL', 'ws://localhost:7880');
    const httpUrl = this.wsUrl.replace(/^ws/, 'http');
    this.roomClient = new RoomServiceClient(httpUrl, this.apiKey, this.apiSecret);
  }

  get url(): string {
    return this.wsUrl;
  }

  createPublisherToken(room: string, identity: string, name: string): Promise<string> {
    return this.token(room, identity, name, true);
  }

  createSubscriberToken(room: string, identity: string, name: string): Promise<string> {
    return this.token(room, identity, name, false);
  }

  private async token(
    room: string,
    identity: string,
    name: string,
    canPublish: boolean,
  ): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, { identity, name });
    at.addGrant({ room, roomJoin: true, canPublish, canSubscribe: true, canPublishData: true });
    return at.toJwt();
  }

  /** Закрыть комнату (при end эфира). Best-effort — падение LiveKit не должно ронять endpoint. */
  async closeRoom(room: string): Promise<void> {
    try {
      await this.roomClient.deleteRoom(room);
    } catch (e) {
      this.logger.warn(`deleteRoom ${room}: ${(e as Error).message}`);
    }
  }

  /** Выкинуть участника из комнаты (kick). Best-effort. */
  async removeParticipant(room: string, identity: string): Promise<void> {
    try {
      await this.roomClient.removeParticipant(room, identity);
    } catch (e) {
      this.logger.warn(`removeParticipant ${room}/${identity}: ${(e as Error).message}`);
    }
  }
}
