import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FollowStatus, NotifType, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { buildCursorPage, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import { FileValidator } from '../../storage/file-validator';
import { MediaService } from '../../storage/media.service';
import { StorageService } from '../../storage/storage.service';
import { UploadedFile } from '../../storage/storage.types';
import {
  ActivityItemDto,
  CollectionDto,
  ActivityQueryDto,
  AvatarDto,
  IsFollowingDto,
  MusicBriefDto,
  OtherProfileDto,
  PostBriefDto,
  ProfileDto,
  UpdateProfileDto,
} from './dto/profile.dto';

const PROFILE_INCLUDE = {
  profile: true,
  _count: {
    select: {
      posts: { where: { isArchived: false } },
      followers: { where: { status: FollowStatus.ACCEPTED } },
      following: { where: { status: FollowStatus.ACCEPTED } },
    },
  },
} satisfies Prisma.UserInclude;

type ProfileRow = Prisma.UserGetPayload<{ include: typeof PROFILE_INCLUDE }>;

const POST_SELECT = {
  id: true,
  caption: true,
  isReel: true,
  createdAt: true,
  media: { select: { url: true, thumbUrl: true }, orderBy: { order: 'asc' }, take: 1 },
  _count: { select: { likes: true, comments: true } },
} satisfies Prisma.PostSelect;

type PostRow = Prisma.PostGetPayload<{ select: typeof POST_SELECT }>;

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly validator: FileValidator,
    private readonly events: EventEmitter2,
  ) {}

  // ─────────────── просмотр профиля ───────────────

  async me(userId: string): Promise<ProfileDto> {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      include: PROFILE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Пользователь не найден');
    return this.toProfile(row);
  }

  async byId(viewerId: string, targetId: string): Promise<OtherProfileDto> {
    // Блокировка → 403 (внутри assertNotBlocked).
    await this.access.assertNotBlocked(viewerId, targetId);

    const row = await this.prisma.user.findFirst({
      where: { id: targetId, isDeleted: false },
      include: PROFILE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Пользователь не найден');

    const [followFromMe, followToMe, blockByMe] = await Promise.all([
      this.prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: viewerId, followingId: targetId } },
        select: { status: true },
      }),
      this.prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: targetId, followingId: viewerId } },
        select: { status: true },
      }),
      this.prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: viewerId, blockedId: targetId } },
        select: { id: true },
      }),
    ]);

    const isFollowing = followFromMe?.status === FollowStatus.ACCEPTED;
    const hasRequestPending = followFromMe?.status === FollowStatus.PENDING;

    // Профиль (аватар, счётчики) виден всем, как в IG; закрыт именно контент.
    const canViewContent = viewerId === targetId || !row.isPrivate || isFollowing;

    // Просмотр профиля — не чаще одной записи в сутки на пару (ТЗ §5.13).
    await this.trackProfileView(viewerId, targetId);

    return {
      ...this.toProfile(row),
      isFollowing,
      isFollowedBy: followToMe?.status === FollowStatus.ACCEPTED,
      isBlocked: blockByMe !== null,
      hasRequestPending,
      canViewContent,
    };
  }

  async isFollowing(viewerId: string, targetId: string): Promise<IsFollowingDto> {
    const f = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: viewerId, followingId: targetId } },
      select: { status: true },
    });
    return {
      isFollowing: f?.status === FollowStatus.ACCEPTED,
      hasRequestPending: f?.status === FollowStatus.PENDING,
    };
  }

  // ─────────────── редактирование ───────────────

  async update(userId: string, dto: UpdateProfileDto): Promise<ProfileDto> {
    const { fullName, dob, ...profileFields } = dto;

    // fullName и dob лежат в User, остальное — в Profile.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName !== undefined ? { fullName } : {}),
        ...(dob !== undefined ? { dob: new Date(dob) } : {}),
        profile: {
          // upsert, а не update: у юзера из старых данных профиля могло не быть.
          upsert: { create: profileFields, update: profileFields },
        },
      },
    });
    return this.me(userId);
  }

  async updatePrivacy(userId: string, isPrivate: boolean): Promise<ProfileDto> {
    await this.prisma.user.update({ where: { id: userId }, data: { isPrivate } });
    return this.me(userId);
  }

  // ─────────────── аватар ───────────────

  async setAvatar(userId: string, file: UploadedFile): Promise<AvatarDto> {
    const validated = await this.validator.validate(file);
    if (validated.kind !== 'IMAGE') {
      throw new NotFoundException('Аватар должен быть изображением');
    }

    const processed = await this.media.process(validated);
    const key = this.storage.buildKey('IMAGE', processed.ext);
    const url = await this.storage.put(key, processed.buffer, processed.mime);

    const old = await this.prisma.profile.findUnique({
      where: { userId },
      select: { avatarUrl: true },
    });

    await this.prisma.profile.upsert({
      where: { userId },
      create: { userId, avatarUrl: url },
      update: { avatarUrl: url },
    });

    // Старый файл чистим ПОСЛЕ успешной записи в БД: упадёт S3 — профиль всё равно валиден.
    await this.removeAvatarObject(old?.avatarUrl);
    return { avatarUrl: url };
  }

  /**
   * Баг softclub #2: удаление аватара ломало логин.
   * У нас аватар — это ОДНО поле `Profile.avatarUrl`. Обнуляем только его:
   * ни строку User, ни passwordHash, ни сам Profile не трогаем — логин не может сломаться.
   */
  async deleteAvatar(userId: string): Promise<AvatarDto> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { avatarUrl: true },
    });

    // Идемпотентно: удалить отсутствующий аватар — не ошибка.
    if (profile?.avatarUrl) {
      await this.prisma.profile.update({ where: { userId }, data: { avatarUrl: null } });
      await this.removeAvatarObject(profile.avatarUrl);
    }
    return { avatarUrl: null };
  }

  /** Файл в S3 — вторичен: если удалить не вышло, профиль уже без аватара. Только лог. */
  private async removeAvatarObject(url?: string | null): Promise<void> {
    if (!url) return;
    const key = this.keyFromUrl(url);
    if (!key) return;
    try {
      await this.storage.remove(key);
    } catch (e) {
      this.logger.warn(`Не удалось удалить старый аватар «${key}»: ${(e as Error).message}`);
    }
  }

  private keyFromUrl(url: string): string | null {
    const base = this.storage.publicUrlFor('');
    return url.startsWith(base) ? url.slice(base.length) : null;
  }

  // ─────────────── вкладки профиля ───────────────

  async posts(
    viewerId: string,
    targetId: string,
    dto: { cursor?: string; limit: number },
    isReel: boolean,
  ): Promise<CursorPage<PostBriefDto>> {
    await this.access.assertCanViewContent(viewerId, targetId);
    return this.pagePosts({ userId: targetId, isReel, isArchived: false }, dto);
  }

  /** Отмеченные: посты других людей, где меня отметили. */
  async tagged(
    viewerId: string,
    targetId: string,
    dto: { cursor?: string; limit: number },
  ): Promise<CursorPage<PostBriefDto>> {
    await this.access.assertCanViewContent(viewerId, targetId);
    return this.pagePosts({ isArchived: false, taggedUsers: { some: { userId: targetId } } }, dto);
  }

  /** Сохранённое — только своё, чужое никому не показываем. */
  async favorites(
    userId: string,
    dto: { cursor?: string; limit: number },
  ): Promise<CursorPage<PostBriefDto>> {
    return this.pagePosts({ isArchived: false, favorites: { some: { userId } } }, dto);
  }

  /**
   * Коллекции сохранённого. Обложка — первое медиа последнего добавленного поста
   * (как в IG), либо явная coverUrl коллекции, если её задали.
   *
   * Отдаём и коллекцию «без названия» (collectionId = null) отдельной строкой?
   * Нет: POST /posts/{id}/favorite без `collection` кладёт пост вне коллекций,
   * такие посты уже видны в /profile/favorites. Здесь — только именованные,
   * иначе фронт показал бы безымянную папку, которую нельзя выбрать при сохранении.
   */
  async collections(userId: string): Promise<CollectionDto[]> {
    const rows = await this.prisma.collection.findMany({
      where: { userId },
      select: {
        name: true,
        coverUrl: true,
        _count: { select: { favorites: true } },
        favorites: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            post: { select: { media: { select: { url: true, thumbUrl: true }, orderBy: { order: 'asc' }, take: 1 } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((c) => {
      const media = c.favorites[0]?.post.media[0];
      return {
        name: c.name,
        postsCount: c._count.favorites,
        coverUrl: c.coverUrl ?? media?.thumbUrl ?? media?.url ?? null,
      };
    });
  }

  /** Репосты: модели Repost нет — репост это Share, сделанный мной. */
  async reposts(
    userId: string,
    dto: { cursor?: string; limit: number },
  ): Promise<CursorPage<PostBriefDto>> {
    return this.pagePosts({ isArchived: false, shares: { some: { userId } } }, dto);
  }

  async savedMusic(userId: string): Promise<MusicBriefDto[]> {
    const rows = await this.prisma.savedMusic.findMany({
      where: { userId },
      select: {
        createdAt: true,
        music: { select: { id: true, title: true, artist: true, coverUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({ ...r.music, savedAt: r.createdAt }));
  }

  private async pagePosts(
    where: Prisma.PostWhereInput,
    dto: { cursor?: string; limit: number },
  ): Promise<CursorPage<PostBriefDto>> {
    const rows = await this.prisma.post.findMany({
      where,
      select: POST_SELECT,
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });
    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return { ...page, items: page.items.map((r) => this.toPostBrief(r)) };
  }

  // ─────────────── «Ваши действия» ───────────────

  /**
   * Лайки / комментарии / просмотры / поисковые запросы одним списком, отсортированным по времени.
   * Четыре разных таблицы, поэтому берём по limit из каждой, сливаем и режем — так дешевле,
   * чем UNION в сыром SQL, и не ломается при добавлении нового типа активности.
   */
  async activity(userId: string, dto: ActivityQueryDto): Promise<ActivityItemDto[]> {
    const range: Prisma.DateTimeFilter = {};
    if (dto.from) range.gte = new Date(dto.from);
    if (dto.to) range.lte = new Date(dto.to);

    /**
     * Курсор здесь — ВРЕМЯ последнего элемента, а не id.
     *
     * Раньше `cursor` был объявлен в ActivityQueryDto (и в Swagger), но не
     * использовался: каждая «следующая» страница возвращала ту же первую —
     * бесконечный список у фронта. Взять id нельзя: список слит из четырёх
     * таблиц, и id=5 есть и у лайка, и у комментария. Общий порядок здесь
     * задаёт только время, поэтому и курсор — время.
     */
    if (dto.cursor) {
      const before = new Date(dto.cursor);
      if (Number.isNaN(before.getTime())) {
        throw new BadRequestException('cursor: ожидается ISO-дата (поле `at` последнего элемента)');
      }
      // lt, а не lte: иначе последний элемент страницы повторился бы на следующей.
      range.lt = before;
    }

    const at = Object.keys(range).length > 0 ? range : undefined;

    const [likes, comments, views, searches] = await Promise.all([
      this.prisma.postLike.findMany({
        where: { userId, ...(at ? { createdAt: at } : {}) },
        select: { id: true, postId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: dto.limit,
      }),
      this.prisma.comment.findMany({
        where: { userId, ...(at ? { createdAt: at } : {}) },
        select: { id: true, postId: true, text: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: dto.limit,
      }),
      this.prisma.postView.findMany({
        where: { userId, ...(at ? { viewedAt: at } : {}) },
        select: { id: true, postId: true, viewedAt: true },
        orderBy: { viewedAt: 'desc' },
        take: dto.limit,
      }),
      this.prisma.searchHistory.findMany({
        where: { userId, ...(at ? { createdAt: at } : {}) },
        select: { id: true, text: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: dto.limit,
      }),
    ]);

    // id составной («LIKE:12»): сам по себе id строки не уникален между таблицами.
    const items: ActivityItemDto[] = [
      ...likes.map((l) => ({
        id: `LIKE:${l.id}`,
        type: 'LIKE' as const,
        at: l.createdAt,
        postId: l.postId,
      })),
      ...comments.map((c) => ({
        id: `COMMENT:${c.id}`,
        type: 'COMMENT' as const,
        at: c.createdAt,
        postId: c.postId,
        text: c.text,
      })),
      ...views.map((v) => ({
        id: `POST_VIEW:${v.id}`,
        type: 'POST_VIEW' as const,
        at: v.viewedAt,
        postId: v.postId,
      })),
      ...searches.map((s) => ({
        id: `SEARCH:${s.id}`,
        type: 'SEARCH' as const,
        at: s.createdAt,
        text: s.text,
      })),
    ];

    return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, dto.limit);
  }

  // ─────────────── helpers ───────────────

  /** Не чаще одной записи в сутки на пару (ТЗ §5.13) — иначе таблица распухнет от F5. */
  private async trackProfileView(viewerId: string, profileUserId: string): Promise<void> {
    if (viewerId === profileUserId) return;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.prisma.profileView.findFirst({
      where: { viewerId, profileUserId, viewedAt: { gte: since } },
      select: { id: true },
    });
    if (recent) return;

    await this.prisma.profileView.create({ data: { viewerId, profileUserId } });
    // Уведомление «кто заходил в профиль» — раз в сутки на пару (тот же порог, что и запись).
    this.events.emit(NOTIFY_EVENT, {
      userId: profileUserId,
      actorId: viewerId,
      type: NotifType.PROFILE_VIEW,
    } satisfies NotifyPayload);
  }

  private toProfile(row: ProfileRow): ProfileDto {
    const p = row.profile;
    return {
      id: row.id,
      userName: row.userName,
      fullName: row.fullName,
      avatarUrl: p?.avatarUrl ?? null,
      about: p?.about ?? null,
      website: p?.website ?? null,
      // gender симметричен: что записали — то и вернём (баг softclub #12).
      gender: p?.gender ?? 'HIDDEN',
      occupation: p?.occupation ?? null,
      dob: row.dob,
      showThreadsBadge: p?.showThreadsBadge ?? false,
      isAiAuthor: p?.isAiAuthor ?? false,
      showAccountSuggestions: p?.showAccountSuggestions ?? true,
      isPrivate: row.isPrivate,
      isVerified: row.isVerified,
      postsCount: row._count.posts,
      followersCount: row._count.followers,
      followingCount: row._count.following,
    };
  }

  private toPostBrief(row: PostRow): PostBriefDto {
    const first = row.media[0];
    return {
      id: row.id,
      caption: row.caption,
      isReel: row.isReel,
      // У видео обложка — постер, у фото — само изображение.
      coverUrl: first?.thumbUrl ?? first?.url ?? null,
      likesCount: row._count.likes,
      commentsCount: row._count.comments,
      createdAt: row.createdAt,
    };
  }
}
