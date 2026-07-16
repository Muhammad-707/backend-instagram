import { NotifType } from '@prisma/client';

/** Единое событие: любой сервис эмитит его, NotificationService — единственный, кто пишет в БД и шлёт в сокет. */
export const NOTIFY_EVENT = 'notification.emit';

export interface NotifyPayload {
  /** Кого уведомляем (получатель). */
  userId: string;
  /** Кто совершил действие. */
  actorId: string;
  type: NotifType;
  postId?: number;
  commentId?: number;
  storyId?: number;
  noteId?: number;
  chatId?: number;
  liveId?: string;
  /** id заявки в эфир — нужен хосту, чтобы принять/отклонить прямо из уведомления. */
  requestId?: number;
}
