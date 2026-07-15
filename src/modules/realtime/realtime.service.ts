import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

/** Комната на пользователя — в неё шлём всё персональное (сообщения, уведомления). */
export const userRoom = (userId: string): string => `user:${userId}`;

/**
 * Мост между REST-слоем и Socket.IO. Гейтвей регистрирует сюда `Server`,
 * а сервисы (chat, а в Фазе 10 — notifications) вызывают emit-методы,
 * не завися от самого гейтвея — так нет циклической зависимости.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  bind(server: Server): void {
    this.server = server;
  }

  /** Событие одному пользователю (во все его вкладки/устройства). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  /** Событие нескольким пользователям (участникам чата). */
  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    if (!this.server) return;
    for (const id of userIds) {
      this.server.to(userRoom(id)).emit(event, payload);
    }
  }

  isReady(): boolean {
    return this.server !== null;
  }
}
