import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

/** Комната эфира — все зрители эфира. */
export const liveRoom = (liveId: string): string => `live:${liveId}`;
/** Персональная комната в namespace /live — точечные события (join-accepted с токеном). */
export const liveUserRoom = (userId: string): string => `liveuser:${userId}`;

/**
 * Мост REST → Socket.IO namespace /live. LiveGateway регистрирует сюда Server,
 * LiveService шлёт события в комнату эфира или конкретному пользователю.
 */
@Injectable()
export class LiveRealtimeService {
  private server: Server | null = null;

  bind(server: Server): void {
    this.server = server;
  }

  /** Всем зрителям эфира (comment, like, reaction, viewers, camera, ended, guest-joined). */
  emitToLive(liveId: string, event: string, payload: unknown): void {
    this.server?.to(liveRoom(liveId)).emit(event, payload);
  }

  /** Одному пользователю в /live (join-request хосту, join-accepted гостю с токеном). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(liveUserRoom(userId)).emit(event, payload);
  }

  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    if (!this.server) return;
    for (const id of userIds) this.server.to(liveUserRoom(id)).emit(event, payload);
  }
}
