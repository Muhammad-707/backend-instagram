import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FollowStatus, MediaType, NotifType, Prisma, ReportTargetType } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { ChatUtilService } from '../../common/chat/chat-util.service';
import { buildCursorPage, CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { FileValidator } from '../../storage/file-validator';
import { MediaService } from '../../storage/media.service';
import { StorageService } from '../../storage/storage.service';
import { UploadedFile } from '../../storage/storage.types';
import { UserBriefDto } from '../users/dto/users.dto';
import { parseHashtags, parseMentions } from './content-parser';
import {
  ArchiveDto,
  CreatePostDto,
  ExploreQueryDto,
  FavoriteToggleDto,
  LikeToggleDto,
  MAX_MEDIA,
  PostDto,
  ShareDto,
  ShareResultDto,
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
  createdAt: true,
  user: { select: USER_BRIEF },
  media: { orderBy: { order: 'asc' } },
  location: { select: { id: true, city: true, country: true } },
  music: { select: { id: true, title: true, artist: true, coverUrl: true } },
  taggedUsers: { select: { user: { select: USER_BRIEF } } },
  hashtags: { select: { hashtag: { select: { name: true } } } },
  _count: { select: { likes: true, comments: true, views: true } },
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

      const post = await this.prisma.post.create({
        data: {
          userId,
          caption: dto.caption ?? null,
          locationId: dto.locationId ?? null,
          musicId: dto.musicId ?? null,
          isReel: dto.isReel ?? false,
          media: { create: mediaRows },
          ...(dto.taggedUserIds?.length
            ? { taggedUsers: { create: dto.taggedUserIds.map((id) => ({ userId: id })) } }
            : {}),
        },
        select: { id: true },
      });

      // Хэштеги, упоминания и уведомления — после создания поста, ему нужен id.
      await this.linkHashtags(post.id, dto.caption);
      await this.linkMentions(post.id, userId, dto.caption);
      await this.notifyTagged(post.id, userId, dto.taggedUserIds);

      if (dto.musicId) {
        await this.prisma.music.update({
          where: { id: dto.musicId },
          data: { usesCount: { increment: 1 } },
        });
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

  // ─────────────────────── ленты ───────────────────────

  /**
   * Лента подписок. Три бага старого API чиним здесь:
   *   #3 — userId берём из JWT, а не из query (иначе можно смотреть чужую ленту);
   *   #4 — курсорная пагинация: страницы реально разные;
   *   #5 — < 300 мс: один запрос с include вместо N+1, сортировка по id (btree),
   *        подписки берём отдельным лёгким запросом по индексу (followerId, status).
   */
  async feed(userId: string, dto: CursorDto): Promise<CursorPage<PostDto>> {
    const following = await this.prisma.follow.findMany({
      where: { followerId: userId, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
    });
    const authorIds = [...following.map((f) => f.followingId), userId];

    const rows = await this.prisma.post.findMany({
      where: { userId: { in: authorIds }, isArchived: false },
      select: POST_SELECT,
      // id, а не createdAt: id монотонен, сравнение целых дешевле и курсор однозначен.
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });

    return this.toPage(userId, rows, dto.limit);
  }

  /** Explore — чужие посты (без своих), закрытые аккаунты и заблокированные исключены. */
  async explore(
    userId: string,
    dto: ExploreQueryDto,
    isReel?: boolean,
  ): Promise<CursorPage<PostDto>> {
    const hidden = await this.access.blockedIds(userId);

    const rows = await this.prisma.post.findMany({
      where: {
        isArchived: false,
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
      },
      select: POST_SELECT,
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });

    return this.toPage(userId, rows, dto.limit);
  }

  /** Reels — тот же Explore, но только видео-посты. */
  async reels(userId: string, dto: CursorDto): Promise<CursorPage<PostDto>> {
    return this.explore(userId, dto, true);
  }

  async my(userId: string, dto: CursorDto, archived = false): Promise<CursorPage<PostDto>> {
    const rows = await this.prisma.post.findMany({
      where: { userId, isArchived: archived },
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

    // Чужой закрытый аккаунт / блокировка → 403.
    await this.access.assertCanViewContent(userId, row.user.id);

    const [liked, favorited] = await Promise.all([
      this.likedIds(userId, [row.id]),
      this.favoritedIds(userId, [row.id]),
    ]);
    return this.toDto(row, liked, favorited);
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
      await this.notify(post.userId, userId, NotifType.LIKE_POST, { postId });
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
    await this.loadVisiblePost(userId, postId);

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
    await this.notify(post.userId, userId, NotifType.SHARE_POST, { postId });

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
      select: { userId: true },
    });
    if (!post) throw new NotFoundException('Публикация не найдена');
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
      await this.prisma.mention.create({ data: { postId, userId: u.id } });
      await this.notify(u.id, actorId, NotifType.MENTION, { postId });
    }
  }

  private async notifyTagged(
    postId: number,
    actorId: string,
    taggedUserIds?: string[],
  ): Promise<void> {
    for (const id of taggedUserIds ?? []) {
      await this.notify(id, actorId, NotifType.TAG_POST, { postId });
    }
  }

  /** Себя не уведомляем; заблокированные друг друга не тревожат (ТЗ §5.13). */
  private async notify(
    userId: string,
    actorId: string,
    type: NotifType,
    extra: { postId?: number; commentId?: number } = {},
  ): Promise<void> {
    if (userId === actorId) return;
    if (await this.access.isBlockedBetween(userId, actorId)) return;

    await this.prisma.notification.create({ data: { userId, actorId, type, ...extra } });
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

    return { ...page, items: page.items.map((r) => this.toDto(r, liked, favorited)) };
  }

  private toDto(row: PostRow, liked: Set<number>, favorited: Set<number>): PostDto {
    return {
      id: row.id,
      caption: row.caption,
      isReel: row.isReel,
      isArchived: row.isArchived,
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
      music: row.music
        ? {
            id: row.music.id,
            title: row.music.title,
            artist: row.music.artist,
            streamUrl: `${this.appUrl}/api/music/${row.music.id}/stream`,
            coverUrl: row.music.coverUrl,
          }
        : null,
      taggedUsers: row.taggedUsers.map((t) => this.toBrief(t.user)),
      hashtags: row.hashtags.map((h) => h.hashtag.name),
      likesCount: row._count.likes,
      commentsCount: row._count.comments,
      viewsCount: row._count.views,
      isLiked: liked.has(row.id),
      isFavorited: favorited.has(row.id),
      createdAt: row.createdAt,
    };
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
