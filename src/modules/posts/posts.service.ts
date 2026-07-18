import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FollowStatus,
  MediaType,
  MusicProvider,
  NotifType,
  PostStatus,
  Prisma,
  ReportTargetType,
  TagStatus,
} from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  JOB_PUBLISH_SCHEDULED_POST,
  POSTS_QUEUE,
  PublishScheduledPostPayload,
} from '../../jobs/jobs.constants';
import { AccessService } from '../../common/access/access.service';
import { ChatUtilService } from '../../common/chat/chat-util.service';
import { AttachedMusicService } from '../music/attached-music.service';
import { OnlineMusicService } from '../music/online/online-music.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import { buildCursorPage, CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { FileValidator } from '../../storage/file-validator';
import { MediaService } from '../../storage/media.service';
import { StorageService } from '../../storage/storage.service';
import { UploadedFile } from '../../storage/storage.types';
import { UserBriefDto } from '../users/dto/users.dto';
import { SettingsService } from '../settings/settings.service';
import { parseHashtags, parseMentions } from './content-parser';
import { ExploreRankingService } from './explore-ranking.service';
import { FeedRankingService, RankedCandidate } from './feed-ranking.service';
import {
  ArchiveDto,
  CreatePostDto,
  ExploreQueryDto,
  FavoriteToggleDto,
  FeedDto,
  LikeToggleDto,
  MAX_MEDIA,
  PostDto,
  ShareDto,
  ShareResultDto,
  TagActionDto,
  UpdatePostPrivacyDto,
  ViewDto,
} from './dto/post.dto';

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

/**
 * Одна выборка на весь пост: автор, медиа, локация, музыка, отметки, хэштеги и счётчики.
 * Именно это убирает N+1 — старый API делал отдельный запрос на каждый пост (лента 21 сек).
 */
const POST_SELECT = {
  id: true,
  caption: true,
  isReel: true,
  isArchived: true,
  status: true,
  scheduledAt: true,
  pinnedAt: true,
  hideLikeCount: true,
  commentsDisabled: true,
  createdAt: true,
  user: { select: USER_BRIEF },
  media: { orderBy: { order: 'asc' } },
  location: { select: { id: true, city: true, country: true } },
  music: {
    select: {
      id: true,
      title: true,
      artist: true,
      coverUrl: true,
      url: true,
      provider: true,
      externalId: true,
    },
  },
  // Только подтверждённые отметки видны на публикации; PENDING/DECLINED не «палят»
  // человека, пока он сам не согласился (как ревью отметок в Instagram).
  taggedUsers: {
    where: { status: TagStatus.ACCEPTED },
    select: { user: { select: USER_BRIEF } },
  },
  hashtags: { select: { hashtag: { select: { name: true } } } },
  _count: { select: { likes: true, comments: true, views: true, favorites: true } },
} satisfies Prisma.PostSelect;

type PostRow = Prisma.PostGetPayload<{ select: typeof POST_SELECT }>;

@Injectable()
export class PostsService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly validator: FileValidator,
    private readonly chat: ChatUtilService,
    private readonly events: EventEmitter2,
    private readonly online: OnlineMusicService,
    private readonly attachedMusic: AttachedMusicService,
    private readonly settings: SettingsService,
    private readonly ranking: FeedRankingService,
    private readonly exploreRanking: ExploreRankingService,
    @InjectQueue(POSTS_QUEUE) private readonly postsQueue: Queue<PublishScheduledPostPayload>,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
  }

  // ─────────────────────── создание ───────────────────────

  async create(userId: string, dto: CreatePostDto, files: UploadedFile[]): Promise<PostDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Нужно хотя бы одно медиа (поле «media»)');
    }
    if (files.length > MAX_MEDIA) {
      throw new BadRequestException(`Максимум ${MAX_MEDIA} медиа, пришло ${files.length}`);
    }

    // Валидируем ВСЁ до заливки — иначе битый 5-й файл оставил бы первые четыре мусором в S3.
    const validated = await Promise.all(files.map((f) => this.validator.validate(f)));
    for (const v of validated) {
      if (v.kind === 'AUDIO') {
        throw new BadRequestException('В посте может быть только фото или видео');
      }
    }

    const stored: { key: string; thumbKey?: string }[] = [];
    try {
      const mediaRows: Prisma.PostMediaCreateWithoutPostInput[] = [];

      for (let i = 0; i < validated.length; i++) {
        const v = validated[i];
        const processed = await this.media.process(v);
        const key = this.storage.buildKey(v.kind, processed.ext);
        const url = await this.storage.put(key, processed.buffer, processed.mime);
        stored.push({ key });

        let thumbUrl: string | undefined;
        if (processed.thumb) {
          const thumbKey = this.storage.buildKey('IMAGE', processed.thumb.ext);
          thumbUrl = await this.storage.put(thumbKey, processed.thumb.buffer, processed.thumb.mime);
          stored[stored.length - 1].thumbKey = thumbKey;
        }

        mediaRows.push({
          url,
          type: v.kind === 'VIDEO' ? MediaType.VIDEO : MediaType.IMAGE,
          order: i,
          width: processed.width,
          height: processed.height,
          duration: processed.duration,
          thumbUrl,
          filter: dto.filters?.[i] ?? null,
        });
      }

      // Трек может прийти как наш `musicId` или как найденный в каталоге
      // (`provider`+`externalId`, GET /music/online) — тогда импортируем его.
      const musicId = await this.resolveMusicId(dto);

      // Настройка «кто может отмечать меня»: отфильтровываем тех, кто запретил.
      const taggable = await this.filterTaggable(userId, dto.taggedUserIds);

      // Статус: без него — сразу публикуем (прежнее поведение); DRAFT/SCHEDULED — скрыто.
      const status = dto.status ?? PostStatus.PUBLISHED;
      const scheduledAt = this.resolveScheduledAt(status, dto.scheduledAt);

      const post = await this.prisma.post.create({
        data: {
          userId,
          caption: dto.caption ?? null,
          locationId: dto.locationId ?? null,
          musicId,
          isReel: dto.isReel ?? false,
          status,
          scheduledAt,
          media: { create: mediaRows },
          ...(taggable.length
            ? {
                taggedUsers: {
                  // Своя отметка сразу ACCEPTED (не спрашиваем себя же), чужая — PENDING:
                  // отмеченный подтвердит через POST /posts/{id}/tag/accept.
                  create: taggable.map((id) => ({
                    userId: id,
                    status: id === userId ? TagStatus.ACCEPTED : TagStatus.PENDING,
                  })),
                },
              }
            : {}),
        },
        select: { id: true },
      });

      // Публикуем сразу — хэштеги/упоминания/уведомления/музыка. Черновик и отложенный
      // ничего не рассылают: хэштеги и уведомления появятся при публикации.
      if (status === PostStatus.PUBLISHED) {
        await this.finalizePublish(post.id);
      } else if (status === PostStatus.SCHEDULED && scheduledAt) {
        await this.enqueuePublish(post.id, scheduledAt);
      }

      return this.byId(userId, post.id);
    } catch (e) {
      // Пост не создался — залитые файлы это мусор, убираем.
      for (const s of stored) {
        await this.storage.remove(s.key).catch(() => undefined);
        if (s.thumbKey) await this.storage.remove(s.thumbKey).catch(() => undefined);
      }
      throw e;
    }
  }

  // ─────────────────────── черновики / отложенная публикация ───────────────────────

  /** Мои черновики и/или запланированные (не видны в лентах и профиле). */
  async drafts(userId: string, dto: CursorDto, status?: PostStatus): Promise<CursorPage<PostDto>> {
    const rows = await this.prisma.post.findMany({
      where: {
        userId,
        status: status ?? { in: [PostStatus.DRAFT, PostStatus.SCHEDULED] },
      },
      select: POST_SELECT,
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });
    return this.toPage(userId, rows, dto.limit);
  }

  /** Опубликовать свой черновик/запланированный пост вручную (кнопка «Опубликовать»). */
  async publish(userId: string, id: number): Promise<PostDto> {
    const post = await this.prisma.post.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });
    if (!post) throw new NotFoundException('Публикация не найдена');
    if (post.userId !== userId) throw new ForbiddenException('Это не ваша публикация');
    if (post.status === PostStatus.PUBLISHED) {
      throw new BadRequestException('Публикация уже опубликована');
    }

    await this.postsQueue.remove(`publish-post-${id}`).catch(() => undefined); // снимаем отложенную задачу, если была
    await this.finalizePublish(id);
    return this.byId(userId, id);
  }

  /** Вызывается BullMQ-процессором в назначенное время. Идемпотентна. */
  async publishScheduled(id: number): Promise<void> {
    const post = await this.prisma.post.findUnique({ where: { id }, select: { status: true } });
    if (!post || post.status === PostStatus.PUBLISHED) return;
    await this.finalizePublish(id);
  }

  /**
   * Перевод поста в PUBLISHED + все побочные эффекты: хэштеги, упоминания, уведомления,
   * счётчик музыки. Одна точка — и для мгновенной, и для отложенной/ручной публикации.
   */
  private async finalizePublish(id: number): Promise<void> {
    const post = await this.prisma.post.update({
      where: { id },
      data: { status: PostStatus.PUBLISHED, scheduledAt: null },
      select: {
        userId: true,
        caption: true,
        musicId: true,
        taggedUsers: { select: { userId: true } },
      },
    });

    await this.linkHashtags(id, post.caption);
    await this.linkMentions(id, post.userId, post.caption);
    this.notifyTagged(
      id,
      post.userId,
      post.taggedUsers.map((t) => t.userId),
    );
    await this.notifyNewPost(id, post.userId);

    if (post.musicId) {
      await this.prisma.music.update({
        where: { id: post.musicId },
        data: { usesCount: { increment: 1 } },
      });
    }
  }

  private resolveScheduledAt(status: PostStatus, raw?: string): Date | null {
    if (status !== PostStatus.SCHEDULED) return null;
    if (!raw) throw new BadRequestException('Для SCHEDULED нужен scheduledAt (время публикации)');
    const at = new Date(raw);
    if (Number.isNaN(at.getTime()))
      throw new BadRequestException('scheduledAt — некорректная дата');
    if (at.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledAt должен быть в будущем');
    }
    return at;
  }

  private async enqueuePublish(id: number, at: Date): Promise<void> {
    try {
      await this.postsQueue.add(
        JOB_PUBLISH_SCHEDULED_POST,
        { postId: id },
        { delay: Math.max(0, at.getTime() - Date.now()), jobId: `publish-post-${id}` },
      );
    } catch {
      // Redis недоступен — пост останется SCHEDULED; подстрахует cron-подметание.
    }
  }

  // ─────────────────────── отметки (Instagram «Фото с вами») ───────────────────────

  /**
   * Мои неподтверждённые отметки — очередь на ревью (как «Отметки» в настройках IG).
   * Отмеченный решает: показать пост в своём профиле («Фото с вами») или скрыть.
   */
  async pendingTags(userId: string, dto: CursorDto): Promise<CursorPage<PostDto>> {
    const rows = await this.prisma.post.findMany({
      where: {
        isArchived: false,
        status: PostStatus.PUBLISHED,
        taggedUsers: { some: { userId, status: TagStatus.PENDING } },
      },
      select: POST_SELECT,
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });
    return this.toPage(userId, rows, dto.limit);
  }

  /** Подтвердить свою отметку → пост появляется в моём «Фото с вами». */
  async acceptTag(userId: string, postId: number): Promise<TagActionDto> {
    const tag = await this.getMyTag(userId, postId);
    if (tag.status !== TagStatus.ACCEPTED) {
      await this.prisma.postTag.update({
        where: { id: tag.id },
        data: { status: TagStatus.ACCEPTED },
      });
    }
    return { status: TagStatus.ACCEPTED };
  }

  /** Отклонить/убрать себя с отметки → пост НЕ показывается в «Фото с вами». */
  async declineTag(userId: string, postId: number): Promise<TagActionDto> {
    const tag = await this.getMyTag(userId, postId);
    if (tag.status !== TagStatus.DECLINED) {
      await this.prisma.postTag.update({
        where: { id: tag.id },
        data: { status: TagStatus.DECLINED },
      });
    }
    return { status: TagStatus.DECLINED };
  }

  private async getMyTag(
    userId: string,
    postId: number,
  ): Promise<{ id: string; status: TagStatus }> {
    const tag = await this.prisma.postTag.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { id: true, status: true },
    });
    if (!tag) throw new NotFoundException('Вас не отмечали на этой публикации');
    return tag;
  }

  // ─────────────────────── ленты ───────────────────────

  /**
   * Лента подписок. Три бага старого API чиним здесь:
   *   #3 — userId берём из JWT, а не из query (иначе можно смотреть чужую ленту);
   *   #4 — курсорная пагинация: страницы реально разные;
   *   #5 — < 300 мс: один запрос с include вместо N+1.
   *
   * Фаза 1 (Feed Ranking): при FEED_RANKED=true лента ранжируется (affinity+recency+
   * engagement−seen) через FeedRankingService; иначе — хронология (откат). В конце —
   * рекомендованные посты (`suggested`) и маркер «You're all caught up» (`allCaughtUp`).
   */
  async feed(userId: string, dto: CursorDto): Promise<FeedDto> {
    const following = await this.prisma.follow.findMany({
      where: { followerId: userId, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
    });
    const authorIds = [...following.map((f) => f.followingId), userId];

    if (!this.ranking.isEnabled()) {
      return this.feedChronological(userId, authorIds, dto);
    }

    const ranked = await this.ranking.rankCandidates(userId, authorIds);
    const offset = dto.cursor ? Math.max(0, Number(dto.cursor) || 0) : 0;
    const slice = ranked.slice(offset, offset + dto.limit);
    const hasMore = ranked.length > offset + dto.limit;
    const nextCursor = hasMore ? String(offset + dto.limit) : null;

    const items = await this.loadPostsInOrder(userId, slice);

    // Рекомендации и «Вы всё посмотрели» — только на последней странице (как в IG внизу ленты).
    const [suggested, allCaughtUp] = hasMore
      ? [[] as PostDto[], false]
      : await Promise.all([
          this.suggestedPosts(userId, authorIds),
          this.ranking.isAllCaughtUp(userId, authorIds),
        ]);

    return { items, nextCursor, hasMore, allCaughtUp, suggested };
  }

  /** Хронологическая лента (откат FEED_RANKED=false): прежнее поведение, id DESC + курсор. */
  private async feedChronological(
    userId: string,
    authorIds: string[],
    dto: CursorDto,
  ): Promise<FeedDto> {
    const rows = await this.prisma.post.findMany({
      where: { userId: { in: authorIds }, isArchived: false, status: PostStatus.PUBLISHED },
      select: POST_SELECT,
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });
    const page = await this.toPage(userId, rows, dto.limit);
    return { ...page, allCaughtUp: false, suggested: [] };
  }

  /**
   * Загружает посты по ранжированному срезу, СОХРАНЯЯ порядок score (findMany его не гарантирует),
   * и проставляет isSeen из результата ранжирования.
   */
  private async loadPostsInOrder(userId: string, slice: RankedCandidate[]): Promise<PostDto[]> {
    if (slice.length === 0) return [];
    const ids = slice.map((s) => s.postId);
    const rows = await this.prisma.post.findMany({
      where: { id: { in: ids } },
      select: POST_SELECT,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set(slice.filter((s) => s.seen).map((s) => s.postId));

    const [liked, favorited] = await Promise.all([
      this.likedIds(userId, ids),
      this.favoritedIds(userId, ids),
    ]);

    return slice
      .map((s) => byId.get(s.postId))
      .filter((r): r is PostRow => r !== undefined)
      .map((r) => this.toDto(userId, r, liked, favorited, seen));
  }

  /**
   * Рекомендованные посты для конца ленты: свежие популярные публикации НЕ-подписок,
   * публичные, без заблокированных. Сортировка по вовлечённости (лайки) — как «Suggested posts».
   */
  private async suggestedPosts(userId: string, authorIds: string[], take = 5): Promise<PostDto[]> {
    const hidden = await this.access.blockedIds(userId);
    const rows = await this.prisma.post.findMany({
      where: {
        isArchived: false,
        status: PostStatus.PUBLISHED,
        isReel: false,
        createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
        userId: { notIn: [...authorIds, ...hidden] },
        user: { isPrivate: false, isDeleted: false },
      },
      select: POST_SELECT,
      orderBy: [{ likes: { _count: 'desc' } }, { id: 'desc' }],
      take,
    });
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [liked, favorited] = await Promise.all([
      this.likedIds(userId, ids),
      this.favoritedIds(userId, ids),
    ]);
    return rows.map((r) => this.toDto(userId, r, liked, favorited));
  }

  /**
   * Explore — чужие посты (без своих), закрытые аккаунты и заблокированные исключены.
   * Фаза 2: при EXPLORE_RANKED=true — персонализация (интересы+вовлечённость+свежесть,
   * дедуп авторов); иначе — хронология (откат). Тот же путь обслуживает Reels (isReel=true).
   */
  async explore(
    userId: string,
    dto: ExploreQueryDto,
    isReel?: boolean,
  ): Promise<CursorPage<PostDto>> {
    const hidden = await this.access.blockedIds(userId);
    const where: Prisma.PostWhereInput = {
      isArchived: false,
      status: PostStatus.PUBLISHED,
      userId: { notIn: [userId, ...hidden] },
      ...(isReel !== undefined ? { isReel } : {}),
      // Контент закрытых аккаунтов в Explore не попадает — только у тех, на кого я подписан.
      OR: [
        { user: { isPrivate: false } },
        {
          user: {
            isPrivate: true,
            followers: { some: { followerId: userId, status: FollowStatus.ACCEPTED } },
          },
        },
      ],
      ...(dto.hashtag
        ? { hashtags: { some: { hashtag: { name: dto.hashtag.toLowerCase() } } } }
        : {}),
      ...(dto.locationId ? { locationId: dto.locationId } : {}),
    };

    if (!this.exploreRanking.isEnabled()) {
      const rows = await this.prisma.post.findMany({
        where,
        select: POST_SELECT,
        orderBy: { id: 'desc' },
        take: dto.limit + 1,
        ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
      });
      return this.toPage(userId, rows, dto.limit);
    }

    // Ранжируем окно недавних кандидатов (свежие N постов), затем offset-пагинация по score.
    const CANDIDATE_LIMIT = 300;
    const candidates = await this.prisma.post.findMany({
      where,
      select: POST_SELECT,
      orderBy: { id: 'desc' },
      take: CANDIDATE_LIMIT,
    });
    if (candidates.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const orderedIds = await this.exploreRanking.rank(
      userId,
      candidates.map((c) => ({
        id: c.id,
        userId: c.user.id,
        createdAt: c.createdAt,
        hashtags: c.hashtags.map((h) => h.hashtag.name),
        likes: c._count.likes,
        comments: c._count.comments,
        views: c._count.views,
        favorites: c._count.favorites,
      })),
    );

    const offset = dto.cursor ? Math.max(0, Number(dto.cursor) || 0) : 0;
    const pageIds = orderedIds.slice(offset, offset + dto.limit);
    const hasMore = orderedIds.length > offset + dto.limit;
    const nextCursor = hasMore ? String(offset + dto.limit) : null;

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const rows = pageIds.map((id) => byId.get(id)).filter((r): r is PostRow => r !== undefined);
    const ids = rows.map((r) => r.id);
    const [liked, favorited] = await Promise.all([
      this.likedIds(userId, ids),
      this.favoritedIds(userId, ids),
    ]);
    return {
      items: rows.map((r) => this.toDto(userId, r, liked, favorited)),
      nextCursor,
      hasMore,
    };
  }

  /** Reels — тот же Explore, но только видео-посты. */
  async reels(userId: string, dto: CursorDto): Promise<CursorPage<PostDto>> {
    return this.explore(userId, dto, true);
  }

  async my(userId: string, dto: CursorDto, archived = false): Promise<CursorPage<PostDto>> {
    const rows = await this.prisma.post.findMany({
      // Только опубликованные — черновики/запланированные живут в GET /posts/drafts.
      where: { userId, isArchived: archived, status: PostStatus.PUBLISHED },
      select: POST_SELECT,
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });
    return this.toPage(userId, rows, dto.limit);
  }

  async byId(userId: string, id: number): Promise<PostDto> {
    const row = await this.prisma.post.findUnique({ where: { id }, select: POST_SELECT });
    if (!row) throw new NotFoundException('Публикация не найдена');

    // Черновик/запланированный виден только автору — остальным его как бы нет.
    if (row.status !== PostStatus.PUBLISHED && row.user.id !== userId) {
      throw new NotFoundException('Публикация не найдена');
    }

    // Чужой закрытый аккаунт / блокировка → 403.
    await this.access.assertCanViewContent(userId, row.user.id);

    const [liked, favorited] = await Promise.all([
      this.likedIds(userId, [row.id]),
      this.favoritedIds(userId, [row.id]),
    ]);
    return this.toDto(userId, row, liked, favorited);
  }

  async pin(userId: string, id: number): Promise<PostDto> {
    await this.assertOwner(userId, id);

    const post = await this.prisma.post.findUnique({
      where: { id },
      select: { pinnedAt: true },
    });
    if (!post) throw new NotFoundException('Публикация не найдена');

    if (post.pinnedAt) {
      // Уже закреплен -> открепить
      await this.prisma.post.update({
        where: { id },
        data: { pinnedAt: null },
      });
    } else {
      // Закрепить -> сначала проверим лимит (максимум 3)
      const count = await this.prisma.post.count({
        where: { userId, pinnedAt: { not: null } },
      });
      if (count >= 3) {
        throw new BadRequestException('Нельзя закрепить больше 3 публикаций в профиле');
      }
      await this.prisma.post.update({
        where: { id },
        data: { pinnedAt: new Date() },
      });
    }

    return this.byId(userId, id);
  }

  async togglePrivacy(userId: string, id: number, dto: UpdatePostPrivacyDto): Promise<PostDto> {
    await this.assertOwner(userId, id);

    const data: Prisma.PostUpdateInput = {};
    if (dto.hideLikeCount !== undefined) {
      data.hideLikeCount = dto.hideLikeCount;
    }
    if (dto.commentsDisabled !== undefined) {
      data.commentsDisabled = dto.commentsDisabled;
    }

    await this.prisma.post.update({
      where: { id },
      data,
    });

    return this.byId(userId, id);
  }

  // ─────────────────────── правка / удаление ───────────────────────

  async updateCaption(userId: string, id: number, caption: string): Promise<PostDto> {
    await this.assertOwner(userId, id);

    await this.prisma.post.update({ where: { id }, data: { caption } });

    // Подпись изменилась — хэштеги и упоминания пересобираем заново.
    await this.prisma.postHashtag.deleteMany({ where: { postId: id } });
    await this.prisma.mention.deleteMany({ where: { postId: id } });
    await this.linkHashtags(id, caption);
    await this.linkMentions(id, userId, caption);

    return this.byId(userId, id);
  }

  async remove(userId: string, id: number): Promise<{ deleted: boolean }> {
    await this.assertOwner(userId, id);

    const media = await this.prisma.postMedia.findMany({
      where: { postId: id },
      select: { url: true, thumbUrl: true },
    });

    // Строку удаляем первой: если S3 не ответит, пост уже не виден — а мусор подчистит cron.
    await this.prisma.post.delete({ where: { id } });

    for (const m of media) {
      for (const url of [m.url, m.thumbUrl]) {
        const key = url ? this.storage.keyFromUrl(url) : null;
        if (key) await this.storage.remove(key).catch(() => undefined);
      }
    }
    return { deleted: true };
  }

  async setArchived(userId: string, id: number, isArchived: boolean): Promise<ArchiveDto> {
    await this.assertOwner(userId, id);
    await this.prisma.post.update({ where: { id }, data: { isArchived } });
    return { isArchived };
  }

  // ─────────────────────── реакции ───────────────────────

  async toggleLike(userId: string, postId: number): Promise<LikeToggleDto> {
    const post = await this.loadVisiblePost(userId, postId);

    const existing = await this.prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.postLike.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.postLike.create({ data: { postId, userId } });
      this.notify(post.userId, userId, NotifType.LIKE_POST, { postId });
    }

    const likesCount = await this.prisma.postLike.count({ where: { postId } });
    return { liked: !existing, likesCount };
  }

  async likes(userId: string, postId: number, dto: CursorDto): Promise<CursorPage<UserBriefDto>> {
    await this.loadVisiblePost(userId, postId);

    const rows = await this.prisma.postLike.findMany({
      where: { postId },
      select: { id: true, user: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });

    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return { ...page, items: page.items.map((r) => this.toBrief(r.user)) };
  }

  /** Просмотр считается ОДИН раз на пользователя (@@unique postId+userId). */
  async view(userId: string, postId: number): Promise<ViewDto> {
    await this.loadVisiblePost(userId, postId);

    const existing = await this.prisma.postView.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.postView.create({ data: { postId, userId } });
    }

    const viewsCount = await this.prisma.postView.count({ where: { postId } });
    return { viewsCount, counted: !existing };
  }

  async toggleFavorite(
    userId: string,
    postId: number,
    collectionName?: string,
  ): Promise<FavoriteToggleDto> {
    const post = await this.loadVisiblePost(userId, postId);

    const existing = await this.prisma.favorite.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.favorite.delete({ where: { id: existing.id } });
      return { favorited: false };
    }

    // Коллекция создаётся на лету — «Сохранить в новую коллекцию» из IG.
    let collectionId: string | null = null;
    if (collectionName) {
      const collection = await this.prisma.collection.upsert({
        where: { userId_name: { userId, name: collectionName } },
        create: { userId, name: collectionName },
        update: {},
        select: { id: true },
      });
      collectionId = collection.id;
    }

    await this.prisma.favorite.create({ data: { postId, userId, collectionId } });
    this.notify(post.userId, userId, NotifType.SAVE_POST, { postId });
    return { favorited: true };
  }

  // ─────────────────────── share / report ───────────────────────

  async share(userId: string, postId: number, dto: ShareDto): Promise<ShareResultDto> {
    const post = await this.loadVisiblePost(userId, postId);
    const link = `${this.appUrl}/p/${postId}`;

    // Просто «Копировать ссылку» — ничего не создаём, кроме записи Share.
    if (!dto.toUserId && !dto.toStory) {
      await this.prisma.share.create({ data: { postId, userId } });
      return { link, message: 'Ссылка на публикацию' };
    }

    if (dto.toStory) {
      await this.prisma.share.create({ data: { postId, userId, toStory: true } });
      // Саму историю создаст Фаза 7 (POST /stories с fromPostId) — здесь только факт репоста.
      return { link, message: 'Публикация отправлена в вашу историю' };
    }

    const toUserId = dto.toUserId;
    if (!toUserId) throw new BadRequestException('Не указан получатель');
    await this.access.assertNotBlocked(userId, toUserId);

    const chat = await this.chat.findOrCreateDirectChat(userId, toUserId);
    await this.prisma.message.create({
      data: { chatId: chat.id, senderId: userId, type: 'POST_SHARE', sharedPostId: postId },
    });
    await this.prisma.share.create({ data: { postId, userId, toUserId } });
    this.notify(post.userId, userId, NotifType.SHARE_POST, { postId });

    return { link, chatId: chat.id, message: 'Публикация отправлена в чат' };
  }

  async report(userId: string, postId: number, reason: string): Promise<{ message: string }> {
    await this.loadVisiblePost(userId, postId);
    await this.prisma.report.create({
      data: {
        reporterId: userId,
        targetType: ReportTargetType.POST,
        targetId: String(postId),
        reason,
      },
    });
    return { message: 'Жалоба отправлена, мы её рассмотрим' };
  }

  // ─────────────────────── helpers ───────────────────────

  /** Пост существует и я имею право его видеть. Возвращает автора — он нужен для уведомлений. */
  private async loadVisiblePost(userId: string, postId: number): Promise<{ userId: string }> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { userId: true, status: true },
    });
    if (!post) throw new NotFoundException('Публикация не найдена');
    // Нельзя лайкать/комментировать/сохранять черновик или запланированный пост.
    if (post.status !== PostStatus.PUBLISHED) {
      throw new NotFoundException('Публикация не найдена');
    }
    await this.access.assertCanViewContent(userId, post.userId);
    return post;
  }

  private async assertOwner(userId: string, postId: number): Promise<void> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { userId: true },
    });
    if (!post) throw new NotFoundException('Публикация не найдена');
    if (post.userId !== userId) throw new ForbiddenException('Это не ваша публикация');
  }

  private async linkHashtags(postId: number, caption?: string | null): Promise<void> {
    const names = parseHashtags(caption);
    if (names.length === 0) return;

    for (const name of names) {
      const tag = await this.prisma.hashtag.upsert({
        where: { name },
        create: { name, postsCount: 1 },
        update: { postsCount: { increment: 1 } },
        select: { id: true },
      });
      await this.prisma.postHashtag.create({ data: { postId, hashtagId: tag.id } });
    }
  }

  private async linkMentions(
    postId: number,
    actorId: string,
    caption?: string | null,
  ): Promise<void> {
    const userNames = parseMentions(caption);
    if (userNames.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { userName: { in: userNames }, isDeleted: false },
      select: { id: true },
    });

    for (const u of users) {
      // Настройка «кто может @упоминать меня»: если запрещено — не создаём упоминание.
      if (!(await this.settings.canMention(u.id, actorId))) continue;
      await this.prisma.mention.create({ data: { postId, userId: u.id } });
      this.notify(u.id, actorId, NotifType.MENTION, { postId });
    }
  }

  /** Оставляет из отмеченных только тех, чья настройка «кто может отмечать меня» это разрешает. */
  private async filterTaggable(actorId: string, taggedUserIds?: string[]): Promise<string[]> {
    if (!taggedUserIds?.length) return [];
    const checks = await Promise.all(
      taggedUserIds.map(async (id) => ((await this.settings.canTag(id, actorId)) ? id : null)),
    );
    return checks.filter((id): id is string => id !== null);
  }

  private notifyTagged(postId: number, actorId: string, taggedUserIds?: string[]): void {
    for (const id of taggedUserIds ?? []) {
      this.notify(id, actorId, NotifType.TAG_POST, { postId });
    }
  }

  /** «Новая публикация от того, на кого вы подписаны» — уведомляем принятых подписчиков автора. */
  private async notifyNewPost(postId: number, authorId: string): Promise<void> {
    const followers = await this.prisma.follow.findMany({
      where: { followingId: authorId, status: FollowStatus.ACCEPTED },
      select: { followerId: true },
    });
    for (const f of followers) {
      this.notify(f.followerId, authorId, NotifType.NEW_POST_FROM_FOLLOWING, { postId });
    }
  }

  /**
   * Эмитим событие — NotificationsService (единственная точка) решит про себя/блок,
   * запишет в БД и мгновенно пушнёт в сокет. Возвращаемого значения нет: это fire-and-forget,
   * уведомление не должно тормозить лайк/коммент.
   */
  private notify(
    userId: string,
    actorId: string,
    type: NotifType,
    extra: { postId?: number; commentId?: number } = {},
  ): void {
    this.events.emit(NOTIFY_EVENT, { userId, actorId, type, ...extra } satisfies NotifyPayload);
  }

  /** Мои лайки/избранное — одним запросом на всю страницу, без N+1. */
  private async likedIds(userId: string, postIds: number[]): Promise<Set<number>> {
    if (postIds.length === 0) return new Set();
    const rows = await this.prisma.postLike.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true },
    });
    return new Set(rows.map((r) => r.postId));
  }

  private async favoritedIds(userId: string, postIds: number[]): Promise<Set<number>> {
    if (postIds.length === 0) return new Set();
    const rows = await this.prisma.favorite.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true },
    });
    return new Set(rows.map((r) => r.postId));
  }

  private async toPage(
    userId: string,
    rows: PostRow[],
    limit: number,
  ): Promise<CursorPage<PostDto>> {
    const page = buildCursorPage(rows, limit, (r) => r.id);
    const ids = page.items.map((r) => r.id);

    const [liked, favorited] = await Promise.all([
      this.likedIds(userId, ids),
      this.favoritedIds(userId, ids),
    ]);

    return { ...page, items: page.items.map((r) => this.toDto(userId, r, liked, favorited)) };
  }

  private toDto(
    viewerId: string,
    row: PostRow,
    liked: Set<number>,
    favorited: Set<number>,
    seen?: Set<number>,
  ): PostDto {
    const showLikes = !row.hideLikeCount || row.user.id === viewerId;
    return {
      id: row.id,
      caption: row.caption,
      isReel: row.isReel,
      isArchived: row.isArchived,
      status: row.status,
      scheduledAt: row.scheduledAt,
      author: this.toBrief(row.user),
      media: row.media.map((m) => ({
        url: m.url,
        type: m.type,
        order: m.order,
        width: m.width,
        height: m.height,
        duration: m.duration,
        thumbUrl: m.thumbUrl,
        filter: m.filter,
      })),
      location: row.location,
      music: this.attachedMusic.toDto(row.music),
      taggedUsers: row.taggedUsers.map((t) => this.toBrief(t.user)),
      hashtags: row.hashtags.map((h) => h.hashtag.name),
      likesCount: showLikes ? row._count.likes : null,
      commentsCount: row._count.comments,
      viewsCount: row._count.views,
      isLiked: liked.has(row.id),
      isFavorited: favorited.has(row.id),
      isSeen: seen ? seen.has(row.id) : undefined,
      pinnedAt: row.pinnedAt,
      hideLikeCount: row.hideLikeCount,
      commentsDisabled: row.commentsDisabled,
      createdAt: row.createdAt,
    };
  }

  /** Наш `musicId` либо трек из каталога по `provider`+`externalId` (импортируем). */
  private async resolveMusicId(dto: {
    musicId?: number;
    provider?: MusicProvider;
    externalId?: string;
  }): Promise<number | null> {
    if (dto.musicId) return dto.musicId;
    if (!dto.externalId) return null;
    if (!dto.provider) {
      throw new BadRequestException('externalId без provider — непонятно, из какого каталога трек');
    }
    return this.online.ensureImported(dto.provider, dto.externalId);
  }

  private toBrief(u: PostRow['user']): UserBriefDto {
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
