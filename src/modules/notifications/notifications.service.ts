import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotifType, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { buildCursorPage, CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { UserBriefDto } from '../users/dto/users.dto';
import { NotificationDto, ProfileViewDto } from './dto/notification.dto';
import { NOTIFY_EVENT, NotifyPayload } from './notification.events';

/** Окно, в котором грузим уведомления для группировки. */
const GROUP_WINDOW = 300;

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

const NOTIF_SELECT = {
  id: true,
  type: true,
  postId: true,
  commentId: true,
  storyId: true,
  noteId: true,
  liveId: true,
  requestId: true,
  isRead: true,
  createdAt: true,
  actorId: true,
  actor: { select: USER_BRIEF },
} satisfies Prisma.NotificationSelect;

type NotifRow = Prisma.NotificationGetPayload<{ select: typeof NOTIF_SELECT }>;
type UserBriefRow = Prisma.UserGetPayload<{ select: typeof USER_BRIEF }>;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
  ) {}

  // ─────────────── приём событий (единственная точка записи) ───────────────

  /**
   * Все сервисы эмитят NOTIFY_EVENT — сюда. Только здесь мы:
   *   1) не уведомляем самого себя,
   *   2) не уведомляем при блокировке в любую сторону,
   *   3) пишем строку в БД,
   *   4) мгновенно пушим в сокет получателю (+ актуальный unread-count).
   */
  @OnEvent(NOTIFY_EVENT)
  async handle(payload: NotifyPayload): Promise<void> {
    try {
      await this.create(payload);
    } catch (e) {
      // Уведомление — не критичный путь: не роняем основное действие (лайк, коммент).
      this.logger.error(`notify failed: ${(e as Error).message}`);
    }
  }

  private async create(p: NotifyPayload): Promise<void> {
    if (p.userId === p.actorId) return; // себя не уведомляем
    if (await this.access.isBlockedBetween(p.userId, p.actorId)) return; // блок не уведомляет

    const notif = await this.prisma.notification.create({
      data: {
        userId: p.userId,
        actorId: p.actorId,
        type: p.type,
        postId: p.postId ?? null,
        commentId: p.commentId ?? null,
        storyId: p.storyId ?? null,
        noteId: p.noteId ?? null,
        chatId: p.chatId ?? null,
        liveId: p.liveId ?? null,
        requestId: p.requestId ?? null,
      },
      select: NOTIF_SELECT,
    });

    // Мгновенный пуш: одиночный DTO этого события + свежий счётчик непрочитанных.
    const unread = await this.unreadCount(p.userId);
    this.realtime.emitToUser(p.userId, 'notification:new', {
      notification: this.toDto([notif]),
      unreadCount: unread.count,
    });
  }

  /**
   * Системное уведомление самому пользователю (VERIFICATION_TRIAL_ENDING и т.п.) — без человека-актора.
   * Обходит правило «себя не уведомляем» намеренно: это сообщение от системы, а не действие юзера.
   */
  async notifySystem(userId: string, type: NotifType): Promise<void> {
    const notif = await this.prisma.notification.create({
      data: { userId, actorId: userId, type },
      select: NOTIF_SELECT,
    });
    const unread = await this.unreadCount(userId);
    this.realtime.emitToUser(userId, 'notification:new', {
      notification: this.toDto([notif]),
      unreadCount: unread.count,
    });
  }

  // ─────────────── чтение ───────────────

  /**
   * Лента с группировкой: «user1 и ещё 5 оценили вашу публикацию».
   * Грузим окно последних уведомлений, схлопываем по ключу (тип + цель),
   * отдаём до limit групп. Курсор — по id самого старого уведомления в отданных группах.
   */
  async list(userId: string, dto: CursorDto): Promise<CursorPage<NotificationDto>> {
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(dto.cursor ? { id: { lt: Number(dto.cursor) } } : {}) },
      select: NOTIF_SELECT,
      orderBy: { id: 'desc' },
      take: GROUP_WINDOW,
    });

    // Схлопываем сохраняя порядок первого (самого свежего) появления ключа.
    const groups = new Map<string, NotifRow[]>();
    for (const r of rows) {
      const k = this.groupKey(r);
      const arr = groups.get(k) ?? [];
      arr.push(r);
      groups.set(k, arr);
    }

    const allGroups = [...groups.values()];
    const take = dto.limit;
    const pageGroups = allGroups.slice(0, take);
    const hasMore = allGroups.length > take || rows.length === GROUP_WINDOW;

    // Курсор — минимальный id среди отданных групп: следующая страница возьмёт id меньше.
    let nextCursor: string | null = null;
    if (hasMore && pageGroups.length > 0) {
      const minId = Math.min(...pageGroups.flatMap((g) => g.map((r) => r.id)));
      nextCursor = String(minId);
    }

    const thumbs = await this.loadThumbs(pageGroups.flat());

    return {
      items: pageGroups.map((g) => this.toDto(g, thumbs)),
      nextCursor,
      hasMore,
    };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  /** Пометить прочитанной — с учётом группы (все уведомления той же цели). */
  async markRead(userId: string, id: number): Promise<{ ok: boolean; updated: number }> {
    const notif = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: NOTIF_SELECT,
    });
    if (!notif) return { ok: true, updated: 0 };

    // Помечаем всю группу — иначе «user1 и ещё 5» осталось бы частично непрочитанным.
    const groupRows = await this.prisma.notification.findMany({
      where: { userId, type: notif.type, ...this.groupTargetWhere(notif) },
      select: { id: true },
    });
    const { count } = await this.prisma.notification.updateMany({
      where: { id: { in: groupRows.map((r) => r.id) }, isRead: false },
      data: { isRead: true },
    });
    return { ok: true, updated: count };
  }

  async markAllRead(userId: string): Promise<{ ok: boolean; updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { ok: true, updated: count };
  }

  /** «Кто заходил в твой профиль» — из ProfileView (не чаще 1/сутки на пару, пишется в profile). */
  async profileViews(userId: string, dto: CursorDto): Promise<CursorPage<ProfileViewDto>> {
    const rows = await this.prisma.profileView.findMany({
      where: { profileUserId: userId },
      select: { id: true, viewedAt: true, viewer: { select: USER_BRIEF } },
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });
    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return {
      ...page,
      items: page.items.map((r) => ({
        id: r.id,
        viewer: this.toBrief(r.viewer),
        viewedAt: r.viewedAt,
      })),
    };
  }

  // ─────────────── helpers ───────────────

  /** Ключ группировки: тип + цель. Лайки одного поста схлопываются, разных постов — нет. */
  private groupKey(r: NotifRow): string {
    if (r.postId) return `${r.type}:post:${r.postId}`;
    if (r.commentId) return `${r.type}:comment:${r.commentId}`;
    if (r.storyId) return `${r.type}:story:${r.storyId}`;
    if (r.noteId) return `${r.type}:note:${r.noteId}`;
    // FOLLOW / FOLLOW_REQUEST / PROFILE_VIEW — группируем по типу.
    return `${r.type}`;
  }

  private groupTargetWhere(r: NotifRow): Prisma.NotificationWhereInput {
    if (r.postId) return { postId: r.postId };
    if (r.commentId) return { commentId: r.commentId };
    if (r.storyId) return { storyId: r.storyId };
    if (r.noteId) return { noteId: r.noteId };
    return {};
  }

  /**
   * Превью постов для строк уведомлений — ОДНИМ запросом на всю страницу.
   *
   * Notification.postId — свободный Int без FK на Post, поэтому связи в Prisma нет
   * и `include: { post: ... }` тут невозможен. Добавлять FK ради превью не стали:
   * на старых строках могут быть id уже удалённых постов, и миграция бы упала.
   * Отсюда же следствие: у удалённого поста превью просто не будет (null), а не 500.
   */
  private async loadThumbs(rows: NotifRow[]): Promise<Map<number, string>> {
    const ids = [...new Set(rows.map((r) => r.postId).filter((id): id is number => id !== null))];
    if (ids.length === 0) return new Map();

    const posts = await this.prisma.post.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        media: { select: { url: true, thumbUrl: true }, orderBy: { order: 'asc' }, take: 1 },
      },
    });

    const map = new Map<number, string>();
    for (const p of posts) {
      const first = p.media[0];
      // У видео обложка — постер, у фото — само изображение.
      const url = first?.thumbUrl ?? first?.url;
      if (url) map.set(p.id, url);
    }
    return map;
  }

  private toDto(group: NotifRow[], thumbs?: Map<number, string>): NotificationDto {
    const latest = group[0];
    // Уникальные акторы (одного и того же человека не считаем дважды).
    const actors = new Set(group.map((r) => r.actorId));
    const othersCount = Math.max(0, actors.size - 1);

    return {
      id: latest.id,
      type: latest.type,
      actor: this.toBrief(latest.actor),
      othersCount,
      message: this.message(latest.type, latest.actor.userName, othersCount),
      postId: latest.postId,
      commentId: latest.commentId,
      storyId: latest.storyId,
      noteId: latest.noteId,
      liveId: latest.liveId,
      requestId: latest.requestId,
      postThumbUrl: (latest.postId ? thumbs?.get(latest.postId) : null) ?? null,
      isRead: group.every((r) => r.isRead),
      groupIds: group.map((r) => r.id),
      createdAt: latest.createdAt,
    };
  }

  private message(type: NotifType, actor: string, others: number): string {
    const who = others > 0 ? `${actor} и ещё ${others}` : actor;
    const verb: Partial<Record<NotifType, string>> = {
      LIKE_POST: 'оценил(и) вашу публикацию',
      COMMENT_POST: 'прокомментировал(и) вашу публикацию',
      REPLY_COMMENT: 'ответил(и) на ваш комментарий',
      LIKE_COMMENT: 'оценил(и) ваш комментарий',
      MENTION: 'упомянул(и) вас',
      FOLLOW: 'подписал(и)сь на вас',
      FOLLOW_REQUEST: 'запросил(и) подписку',
      FOLLOW_ACCEPTED: 'принял(и) вашу заявку',
      LIKE_STORY: 'оценил(и) вашу историю',
      STORY_REACTION: 'отреагировал(и) на вашу историю',
      STORY_REPLY: 'ответил(и) на вашу историю',
      LIKE_NOTE: 'оценил(и) вашу заметку',
      REPLY_NOTE: 'ответил(и) на вашу заметку',
      SHARE_POST: 'поделил(и)сь вашей публикацией',
      REPOST_POST: 'репостнул(и) вашу публикацию',
      SAVE_POST: 'сохранил(и) вашу публикацию',
      TAG_POST: 'отметил(и) вас на публикации',
      PROFILE_VIEW: 'посмотрел(и) ваш профиль',
      NEW_POST_FROM_FOLLOWING: 'опубликовал(и) новое',
      VERIFICATION_TRIAL_ENDING: 'Пробный период верификации заканчивается',
      LIVE_STARTED: 'начал(и) прямой эфир',
      LIVE_JOIN_REQUEST: 'хочет(ят) присоединиться к вашему эфиру',
      LIVE_JOIN_ACCEPTED: 'принял(и) вас в эфир',
      LIVE_JOIN_DECLINED: 'отклонил(и) вашу заявку в эфир',
    };
    const tail = verb[type] ?? 'уведомление';
    return type === 'VERIFICATION_TRIAL_ENDING' ? tail : `${who} ${tail}`;
  }

  private toBrief(u: UserBriefRow): UserBriefDto {
    return {
      id: u.id,
      userName: u.userName,
      fullName: u.fullName,
      avatarUrl: u.profile?.avatarUrl ?? null,
      isVerified: u.isVerified,
      isPrivate: u.isPrivate,
    };
  }
}
