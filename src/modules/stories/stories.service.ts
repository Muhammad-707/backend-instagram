import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FollowStatus, MediaType, MsgType, NotifType, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AccessService } from '../../common/access/access.service';
import {
  DeleteExpiredStoryPayload,
  JOB_DELETE_EXPIRED_STORY,
  STORIES_QUEUE,
} from '../../jobs/jobs.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { FileValidator } from '../../storage/file-validator';
import { MediaService } from '../../storage/media.service';
import { StorageService } from '../../storage/storage.service';
import { UploadedFile } from '../../storage/storage.types';
import { UserBriefDto } from '../users/dto/users.dto';
import {
  CreateStoryDto,
  ReactionSentDto,
  StoryDto,
  StoryLikeToggleDto,
  StoryRailItemDto,
  StoryViewerDto,
} from './dto/story.dto';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

const STORY_SELECT = {
  id: true,
  userId: true,
  mediaUrl: true,
  mediaType: true,
  thumbUrl: true,
  duration: true,
  musicStartSec: true,
  overlays: true,
  filter: true,
  closeFriendsOnly: true,
  fromPostId: true,
  createdAt: true,
  expiresAt: true,
  music: { select: { id: true, title: true, artist: true, coverUrl: true } },
  _count: { select: { likes: true } },
} satisfies Prisma.StorySelect;

type StoryRow = Prisma.StoryGetPayload<{ select: typeof STORY_SELECT }>;
type UserBriefRow = Prisma.UserGetPayload<{ select: typeof USER_BRIEF }>;

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly validator: FileValidator,
    @InjectQueue(STORIES_QUEUE) private readonly queue: Queue<DeleteExpiredStoryPayload>,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
  }

  // ─────────────────────── создание (мультизагрузка) ───────────────────────

  /**
   * До 10 файлов ОДНИМ запросом → 10 отдельных Story (как в IG, где выбираешь несколько
   * фото и они уходят серией). Каждая история — своя запись, свой expiresAt, своя BullMQ-задача.
   */
  async create(userId: string, dto: CreateStoryDto, files: UploadedFile[]): Promise<StoryDto[]> {
    const overlays = this.parseOverlays(dto.overlays);

    // Репост поста в историю — файлов может не быть, берём обложку поста.
    if (dto.fromPostId && (!files || files.length === 0)) {
      const story = await this.createFromPost(userId, dto, overlays);
      return [story];
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('Нужен хотя бы один файл (поле «media») или fromPostId');
    }

    const validated = await Promise.all(files.map((f) => this.validator.validate(f)));
    for (const v of validated) {
      if (v.kind === 'AUDIO') throw new BadRequestException('История — только фото или видео');
    }

    const created: number[] = [];
    const stored: { key: string; thumbKey?: string }[] = [];
    try {
      for (const v of validated) {
        const processed = await this.media.process(v);
        const key = this.storage.buildKey(v.kind, processed.ext);
        const mediaUrl = await this.storage.put(key, processed.buffer, processed.mime);
        stored.push({ key });

        let thumbUrl: string | undefined;
        if (processed.thumb) {
          const thumbKey = this.storage.buildKey('IMAGE', processed.thumb.ext);
          thumbUrl = await this.storage.put(thumbKey, processed.thumb.buffer, processed.thumb.mime);
          stored[stored.length - 1].thumbKey = thumbKey;
        }

        const expiresAt = new Date(Date.now() + STORY_TTL_MS);
        const story = await this.prisma.story.create({
          data: {
            userId,
            mediaUrl,
            mediaType: v.kind === 'VIDEO' ? MediaType.VIDEO : MediaType.IMAGE,
            thumbUrl,
            duration: processed.duration ?? 5,
            musicId: dto.musicId ?? null,
            musicStartSec: dto.musicStartSec ?? null,
            overlays: overlays ?? Prisma.DbNull,
            filter: dto.filter ?? null,
            closeFriendsOnly: dto.closeFriendsOnly ?? false,
            expiresAt,
          },
          select: { id: true },
        });
        created.push(story.id);
        await this.scheduleDeletion(story.id, expiresAt);
      }

      if (dto.musicId) {
        await this.prisma.music.update({
          where: { id: dto.musicId },
          data: { usesCount: { increment: created.length } },
        });
      }

      return this.loadMany(userId, created);
    } catch (e) {
      for (const s of stored) {
        await this.storage.remove(s.key).catch(() => undefined);
        if (s.thumbKey) await this.storage.remove(s.thumbKey).catch(() => undefined);
      }
      throw e;
    }
  }

  private async createFromPost(
    userId: string,
    dto: CreateStoryDto,
    overlays: Prisma.InputJsonValue | null,
  ): Promise<StoryDto> {
    const post = await this.prisma.post.findUnique({
      where: { id: dto.fromPostId },
      select: { userId: true, media: { orderBy: { order: 'asc' }, take: 1 } },
    });
    if (!post) throw new NotFoundException('Публикация не найдена');
    await this.access.assertCanViewContent(userId, post.userId);

    const cover = post.media[0];
    if (!cover) throw new BadRequestException('У публикации нет медиа');

    const expiresAt = new Date(Date.now() + STORY_TTL_MS);
    const story = await this.prisma.story.create({
      data: {
        userId,
        mediaUrl: cover.thumbUrl ?? cover.url,
        mediaType: MediaType.IMAGE,
        duration: 5,
        overlays: overlays ?? Prisma.DbNull,
        closeFriendsOnly: dto.closeFriendsOnly ?? false,
        fromPostId: dto.fromPostId,
        expiresAt,
      },
      select: { id: true },
    });
    await this.scheduleDeletion(story.id, expiresAt);

    const [dtoResult] = await this.loadMany(userId, [story.id]);
    return dtoResult;
  }

  // ─────────────────────── рейл и просмотр ───────────────────────

  /**
   * Рейл историй: сгруппировано по авторам (я + мои подписки), у которых есть НЕистёкшие истории.
   * isViewed и allViewed считаются НА СЕРВЕРЕ (баг softclub #17: клиент хранил в localStorage).
   * Истории «только для близких» вижу, лишь если автор добавил меня в close friends.
   */
  async rail(userId: string): Promise<StoryRailItemDto[]> {
    const following = await this.prisma.follow.findMany({
      where: { followerId: userId, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
    });
    const authorIds = [...following.map((f) => f.followingId), userId];

    // У кого я в близких друзьях — только их closeFriendsOnly-истории мне видны.
    const closeOf = await this.prisma.closeFriend.findMany({
      where: { friendId: userId },
      select: { userId: true },
    });
    const closeOfSet = new Set(closeOf.map((c) => c.userId));

    const stories = await this.prisma.story.findMany({
      where: {
        userId: { in: authorIds },
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        userId: true,
        closeFriendsOnly: true,
        createdAt: true,
        user: { select: USER_BRIEF },
        views: { where: { userId }, select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Группируем по автору, попутно фильтруя недоступные close-friends истории.
    const byAuthor = new Map<string, { author: UserBriefRow; items: typeof stories }>();
    for (const s of stories) {
      const isOwn = s.userId === userId;
      if (s.closeFriendsOnly && !isOwn && !closeOfSet.has(s.userId)) continue;

      const entry = byAuthor.get(s.userId) ?? { author: s.user, items: [] };
      entry.items.push(s);
      byAuthor.set(s.userId, entry);
    }

    const rail: StoryRailItemDto[] = [];
    for (const { author, items } of byAuthor.values()) {
      if (items.length === 0) continue;
      rail.push({
        author: this.toBrief(author),
        count: items.length,
        // Кольцо серое, только если ВСЕ истории автора уже просмотрены мной.
        allViewed: items.every((s) => s.views.length > 0),
        hasCloseFriends: items.some((s) => s.closeFriendsOnly),
        latestAt: items[items.length - 1].createdAt,
      });
    }

    // Свои истории — первыми, дальше по свежести; полностью просмотренные — в конец.
    return rail.sort((a, b) => {
      if (a.author.id === userId) return -1;
      if (b.author.id === userId) return 1;
      if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
      return b.latestAt.getTime() - a.latestAt.getTime();
    });
  }

  async byUser(viewerId: string, targetId: string): Promise<StoryDto[]> {
    await this.access.assertCanViewContent(viewerId, targetId);

    const rows = await this.prisma.story.findMany({
      where: { userId: targetId, expiresAt: { gt: new Date() } },
      select: STORY_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    // close-friends истории чужого автора — только если я у него в близких.
    const visible = await this.filterCloseFriends(viewerId, rows);
    return this.decorate(viewerId, visible);
  }

  async mine(userId: string): Promise<StoryDto[]> {
    const rows = await this.prisma.story.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: STORY_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return this.decorate(userId, rows);
  }

  async archive(userId: string): Promise<StoryDto[]> {
    // Свои истёкшие — те, что ещё физически лежат в БД (в актуальном или не успел удалить cron).
    const rows = await this.prisma.story.findMany({
      where: { userId, expiresAt: { lte: new Date() } },
      select: STORY_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return this.decorate(userId, rows);
  }

  async byId(viewerId: string, id: number): Promise<StoryDto> {
    const story = await this.loadVisible(viewerId, id);
    const [dto] = await this.decorate(viewerId, [story]);
    return dto;
  }

  /** Просмотр считается ОДИН раз на зрителя, на СЕРВЕРЕ (@@unique storyId+userId). */
  async view(viewerId: string, id: number): Promise<{ viewed: boolean }> {
    const story = await this.loadVisible(viewerId, id);
    // Свой просмотр не считаем — иначе автор «сам себе зритель».
    if (story.userId === viewerId) return { viewed: true };

    await this.prisma.storyView.upsert({
      where: { storyId_userId: { storyId: id, userId: viewerId } },
      create: { storyId: id, userId: viewerId },
      update: {},
    });
    return { viewed: true };
  }

  async toggleLike(viewerId: string, id: number): Promise<StoryLikeToggleDto> {
    const story = await this.loadVisible(viewerId, id);

    const existing = await this.prisma.storyLike.findUnique({
      where: { storyId_userId: { storyId: id, userId: viewerId } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.storyLike.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.storyLike.create({ data: { storyId: id, userId: viewerId } });
      await this.notify(story.userId, viewerId, NotifType.LIKE_STORY, id);
    }

    const likesCount = await this.prisma.storyLike.count({ where: { storyId: id } });
    // boolean, НЕ строка "Liked" (баг softclub #15).
    return { liked: !existing, likesCount };
  }

  // ─────────────────────── реакция / ответ → в чат ───────────────────────

  /** Реакция emoji → сообщение в чат (type=STORY_REACTION). Без @@unique — можно много раз. */
  async react(viewerId: string, id: number, emoji: string): Promise<ReactionSentDto> {
    const story = await this.loadVisible(viewerId, id);
    if (story.userId === viewerId) {
      throw new BadRequestException('Нельзя реагировать на свою историю');
    }

    const chat = await this.findOrCreateChat(viewerId, story.userId);
    const message = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        senderId: viewerId,
        type: MsgType.STORY_REACTION,
        text: emoji,
        storyId: id,
      },
      select: { id: true },
    });

    await this.prisma.storyReaction.create({
      data: { storyId: id, userId: viewerId, emoji, messageId: message.id },
    });
    await this.notify(story.userId, viewerId, NotifType.STORY_REACTION, id);

    return { sent: true, chatId: chat.id, messageId: message.id };
  }

  /** Ответ на историю → сообщение в чат (type=STORY_REPLY). */
  async reply(viewerId: string, id: number, text: string): Promise<ReactionSentDto> {
    const story = await this.loadVisible(viewerId, id);
    if (story.userId === viewerId) {
      throw new BadRequestException('Нельзя ответить на свою историю');
    }

    const chat = await this.findOrCreateChat(viewerId, story.userId);
    const message = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        senderId: viewerId,
        type: MsgType.STORY_REPLY,
        text,
        storyId: id,
      },
      select: { id: true },
    });

    await this.prisma.storyReply.create({
      data: { storyId: id, userId: viewerId, text, messageId: message.id },
    });
    await this.notify(story.userId, viewerId, NotifType.STORY_REPLY, id);

    return { sent: true, chatId: chat.id, messageId: message.id };
  }

  // ─────────────────────── зрители (только автору) ───────────────────────

  /**
   * Полный список зрителей: кто смотрел + кто лайкнул + какая реакция (баг softclub #16 —
   * там были только два счётчика). Видит ТОЛЬКО автор истории.
   */
  async viewers(userId: string, id: number): Promise<StoryViewerDto[]> {
    const story = await this.prisma.story.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!story) throw new NotFoundException('История не найдена');
    if (story.userId !== userId) {
      throw new ForbiddenException('Список зрителей виден только автору');
    }

    const [views, likes, reactions] = await Promise.all([
      this.prisma.storyView.findMany({
        where: { storyId: id },
        select: { userId: true, viewedAt: true, user: { select: USER_BRIEF } },
        orderBy: { viewedAt: 'desc' },
      }),
      this.prisma.storyLike.findMany({ where: { storyId: id }, select: { userId: true } }),
      this.prisma.storyReaction.findMany({
        where: { storyId: id },
        select: { userId: true, emoji: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const likedSet = new Set(likes.map((l) => l.userId));
    // Последняя реакция каждого зрителя.
    const reactionByUser = new Map<string, string>();
    for (const r of reactions) {
      if (!reactionByUser.has(r.userId)) reactionByUser.set(r.userId, r.emoji);
    }

    return views.map((v) => ({
      user: this.toBrief(v.user),
      viewed: true,
      liked: likedSet.has(v.userId),
      reaction: reactionByUser.get(v.userId) ?? null,
      viewedAt: v.viewedAt,
    }));
  }

  async remove(userId: string, id: number): Promise<{ deleted: boolean }> {
    const story = await this.prisma.story.findUnique({
      where: { id },
      select: { userId: true, mediaUrl: true, thumbUrl: true },
    });
    if (!story) throw new NotFoundException('История не найдена');
    if (story.userId !== userId) throw new ForbiddenException('Это не ваша история');

    await this.prisma.story.delete({ where: { id } });
    for (const url of [story.mediaUrl, story.thumbUrl]) {
      const key = url ? this.storage.keyFromUrl(url) : null;
      if (key) await this.storage.remove(key).catch(() => undefined);
    }
    return { deleted: true };
  }

  // ─────────────────────── helpers ───────────────────────

  private async scheduleDeletion(storyId: number, expiresAt: Date): Promise<void> {
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    try {
      await this.queue.add(
        JOB_DELETE_EXPIRED_STORY,
        { storyId },
        {
          delay,
          // Уникальный jobId — повторный запуск не поставит дубль задачи.
          jobId: `story-${storyId}`,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );
    } catch (e) {
      // Redis недоступен — не роняем создание истории. Подстрахует cron-очистка.
      this.logger.error(
        `Не удалось поставить задачу удаления story ${storyId}: ${(e as Error).message}`,
      );
    }
  }

  private async loadVisible(viewerId: string, id: number): Promise<StoryRow> {
    const story = await this.prisma.story.findUnique({ where: { id }, select: STORY_SELECT });
    if (!story) throw new NotFoundException('История не найдена');

    await this.access.assertCanViewContent(viewerId, story.userId);

    // close-friends история чужого автора видна, только если я у него в близких.
    if (story.closeFriendsOnly && story.userId !== viewerId) {
      const isClose = await this.prisma.closeFriend.findUnique({
        where: { userId_friendId: { userId: story.userId, friendId: viewerId } },
        select: { userId: true },
      });
      if (!isClose) throw new ForbiddenException('История доступна только близким друзьям автора');
    }
    return story;
  }

  private async filterCloseFriends(viewerId: string, rows: StoryRow[]): Promise<StoryRow[]> {
    const hasClose = rows.some((s) => s.closeFriendsOnly && s.userId !== viewerId);
    if (!hasClose) return rows;

    const authorIds = [...new Set(rows.map((s) => s.userId))];
    const closeLinks = await this.prisma.closeFriend.findMany({
      where: { friendId: viewerId, userId: { in: authorIds } },
      select: { userId: true },
    });
    const closeOf = new Set(closeLinks.map((c) => c.userId));

    return rows.filter(
      (s) => !s.closeFriendsOnly || s.userId === viewerId || closeOf.has(s.userId),
    );
  }

  private async loadMany(viewerId: string, ids: number[]): Promise<StoryDto[]> {
    const rows = await this.prisma.story.findMany({
      where: { id: { in: ids } },
      select: STORY_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return this.decorate(viewerId, rows);
  }

  /** Проставляет isViewed/isLiked одним запросом на всю пачку — без N+1. */
  private async decorate(viewerId: string, rows: StoryRow[]): Promise<StoryDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const [views, likes] = await Promise.all([
      this.prisma.storyView.findMany({
        where: { userId: viewerId, storyId: { in: ids } },
        select: { storyId: true },
      }),
      this.prisma.storyLike.findMany({
        where: { userId: viewerId, storyId: { in: ids } },
        select: { storyId: true },
      }),
    ]);
    const viewed = new Set(views.map((v) => v.storyId));
    const liked = new Set(likes.map((l) => l.storyId));

    return rows.map((r) => this.toDto(r, viewed.has(r.id), liked.has(r.id)));
  }

  /** Публичная сборка StoryDto — переиспользуется HighlightsService. */
  buildDto(row: StoryRow, isViewed: boolean, isLiked: boolean): StoryDto {
    return this.toDto(row, isViewed, isLiked);
  }

  private toDto(row: StoryRow, isViewed: boolean, isLiked: boolean): StoryDto {
    return {
      id: row.id,
      mediaUrl: row.mediaUrl,
      mediaType: row.mediaType,
      thumbUrl: row.thumbUrl,
      duration: row.duration,
      music: row.music
        ? {
            id: row.music.id,
            title: row.music.title,
            artist: row.music.artist,
            streamUrl: `${this.appUrl}/api/music/${row.music.id}/stream`,
            coverUrl: row.music.coverUrl,
            startSec: row.musicStartSec,
          }
        : null,
      overlays: row.overlays ?? null,
      filter: row.filter,
      closeFriendsOnly: row.closeFriendsOnly,
      fromPostId: row.fromPostId,
      isViewed,
      isLiked,
      likesCount: row._count.likes,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  private parseOverlays(raw?: string): Prisma.InputJsonValue | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Prisma.InputJsonValue;
    } catch {
      throw new BadRequestException('overlays: невалидный JSON');
    }
  }

  private async findOrCreateChat(a: string, b: string): Promise<{ id: number }> {
    const existing = await this.prisma.chat.findFirst({
      where: {
        isGroup: false,
        AND: [{ participants: { some: { userId: a } } }, { participants: { some: { userId: b } } }],
      },
      select: { id: true },
    });
    if (existing) return existing;

    return this.prisma.chat.create({
      data: { isGroup: false, participants: { create: [{ userId: a }, { userId: b }] } },
      select: { id: true },
    });
  }

  private async notify(
    userId: string,
    actorId: string,
    type: NotifType,
    storyId: number,
  ): Promise<void> {
    if (userId === actorId) return;
    if (await this.access.isBlockedBetween(userId, actorId)) return;
    await this.prisma.notification.create({ data: { userId, actorId, type, storyId } });
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
