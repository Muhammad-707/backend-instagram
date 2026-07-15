import { Injectable } from '@nestjs/common';
import { FollowStatus, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PostDto } from '../posts/dto/post.dto';
import { PostsService } from '../posts/posts.service';
import { UserBriefDto } from '../users/dto/users.dto';
import { HashtagDto, SearchResultDto, TopResultDto } from './dto/search.dto';

/** Сколько элементов каждой группы отдаём в превью-поиске (не пагинируем — это подсказки). */
const PREVIEW_LIMIT = 10;
const TOP_LIMIT = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

type UserBriefRow = Prisma.UserGetPayload<{ select: typeof USER_BRIEF }>;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly posts: PostsService,
  ) {}

  /**
   * Комбинированный поиск: аккаунты + хэштеги + локации ОДНИМ ответом.
   * Аккаунты — по userName И fullName (подстрока, ILIKE). Приватные аккаунты видны
   * (контент скрыт на уровне постов), заблокированные — вырезаны.
   */
  async searchAll(viewerId: string, rawQ: string): Promise<SearchResultDto> {
    const q = rawQ.trim();
    const hidden = await this.access.blockedIds(viewerId);
    // Хэштег обычно вводят с «#» — ищем по чистому имени.
    const tag = q.replace(/^#/, '');
    const insensitive = Prisma.QueryMode.insensitive;

    const [users, hashtags, locations] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          isDeleted: false,
          id: { notIn: hidden },
          OR: [
            { userName: { contains: q, mode: insensitive } },
            { fullName: { contains: q, mode: insensitive } },
          ],
        },
        select: USER_BRIEF,
        orderBy: [{ userName: 'asc' }],
        take: PREVIEW_LIMIT,
      }),
      this.prisma.hashtag.findMany({
        where: { name: { contains: tag, mode: insensitive } },
        select: { id: true, name: true, postsCount: true },
        orderBy: { postsCount: 'desc' },
        take: PREVIEW_LIMIT,
      }),
      this.prisma.location.findMany({
        where: {
          OR: [
            { city: { contains: q, mode: insensitive } },
            { state: { contains: q, mode: insensitive } },
            { country: { contains: q, mode: insensitive } },
          ],
        },
        select: { id: true, city: true, state: true, country: true },
        take: PREVIEW_LIMIT,
      }),
    ]);

    return {
      users: users.map((u) => this.toBrief(u)),
      hashtags,
      locations,
    };
  }

  /** Сетка Explore — делегируем в готовый PostsService (посты+видео, likesCount/commentsCount, cursor). */
  async explore(viewerId: string, dto: CursorDto): Promise<CursorPage<PostDto>> {
    return this.posts.explore(viewerId, dto);
  }

  /** Все посты с хэштегом — тот же explore с фильтром по имени тега. */
  async byHashtag(viewerId: string, name: string, dto: CursorDto): Promise<CursorPage<PostDto>> {
    const hashtag = name.replace(/^#/, '').toLowerCase();
    return this.posts.explore(viewerId, { ...dto, hashtag });
  }

  /**
   * Тренды: популярные хэштеги за неделю + аккаунты недели (макс. прирост подписчиков за 7 дней).
   * Если за неделю активности не было — честный фолбэк на общий топ, чтобы блок не был пустым.
   */
  async top(viewerId: string): Promise<TopResultDto> {
    const hidden = await this.access.blockedIds(viewerId);
    const weekAgo = new Date(Date.now() - WEEK_MS);

    const [hashtags, accounts] = await Promise.all([
      this.topHashtags(weekAgo),
      this.topAccounts(viewerId, hidden, weekAgo),
    ]);

    return { hashtags, accounts };
  }

  // ─────────────── helpers ───────────────

  private async topHashtags(weekAgo: Date): Promise<HashtagDto[]> {
    // Тренд = сколько раз тег использован в постах за последние 7 дней.
    const grouped = await this.prisma.postHashtag.groupBy({
      by: ['hashtagId'],
      where: { post: { createdAt: { gte: weekAgo }, isArchived: false } },
      _count: { postId: true },
      orderBy: { _count: { postId: 'desc' } },
      take: TOP_LIMIT,
    });

    const ids = grouped.map((g) => g.hashtagId);
    if (ids.length === 0) {
      // Фолбэк: свежих постов нет — отдаём общий топ по postsCount.
      return this.prisma.hashtag.findMany({
        select: { id: true, name: true, postsCount: true },
        orderBy: { postsCount: 'desc' },
        take: TOP_LIMIT,
      });
    }

    const rows = await this.prisma.hashtag.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, postsCount: true },
    });
    // Сохраняем порядок «по трендовости» (groupBy), а не по id.
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((h): h is HashtagDto => h !== undefined);
  }

  private async topAccounts(
    viewerId: string,
    hidden: string[],
    weekAgo: Date,
  ): Promise<UserBriefDto[]> {
    const excluded = [viewerId, ...hidden];

    const grouped = await this.prisma.follow.groupBy({
      by: ['followingId'],
      where: {
        status: FollowStatus.ACCEPTED,
        createdAt: { gte: weekAgo },
        followingId: { notIn: excluded },
      },
      _count: { followerId: true },
      orderBy: { _count: { followerId: 'desc' } },
      take: TOP_LIMIT,
    });

    const ids = grouped.map((g) => g.followingId);
    if (ids.length === 0) {
      // Фолбэк: за неделю никто не подписывался — общий топ по числу подписчиков.
      const rows = await this.prisma.user.findMany({
        where: { isDeleted: false, id: { notIn: excluded } },
        select: USER_BRIEF,
        orderBy: { followers: { _count: 'desc' } },
        take: TOP_LIMIT,
      });
      return rows.map((u) => this.toBrief(u));
    }

    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids }, isDeleted: false },
      select: USER_BRIEF,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((u): u is UserBriefRow => u !== undefined)
      .map((u) => this.toBrief(u));
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
