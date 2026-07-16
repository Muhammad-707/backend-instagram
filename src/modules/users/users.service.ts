import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FollowStatus, Prisma, ReportTargetType } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { buildCursorPage, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AccountDeletedDto,
  DeletedCountDto,
  ReportCreatedDto,
  SearchHistoryItemDto,
  SearchedUserItemDto,
  SearchUsersDto,
  SuggestionDto,
  UserBriefDto,
} from './dto/users.dto';

/** ТЗ §7: 30 дней на восстановление, потом hard-delete (cron в Фазе 12). */
const SOFT_DELETE_DAYS = 30;
/** Сколько имён показать в «Подписаны: a, b и ещё N». */
const FOLLOWED_BY_PREVIEW = 2;

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
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  // ─────────────── поиск ───────────────

  /** Ищем И по userName, И по fullName, подстрокой, регистронезависимо («er» → eraj, amERica). */
  async search(viewerId: string, dto: SearchUsersDto): Promise<CursorPage<UserBriefDto>> {
    const q = dto.q?.trim();
    // Заблокированные не показываются в поиске (ТЗ §5.4 / BlockGuard).
    const hidden = await this.access.blockedIds(viewerId);

    const where: Prisma.UserWhereInput = {
      isDeleted: false,
      id: { notIn: hidden },
      ...(q
        ? {
            OR: [
              { userName: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { fullName: { contains: q, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      select: USER_BRIEF,
      orderBy: [{ userName: 'asc' }, { id: 'asc' }],
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });

    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return { ...page, items: page.items.map((r) => this.toBrief(r)) };
  }

  /**
   * Точное совпадение по userName, регистронезависимо.
   *
   * Зачем отдельно от search(): `@упоминание` ведёт на /u/{userName}, а search()
   * ищет подстрокой И по fullName — «er» вернёт и eraj, и amERica, и выбирать
   * точное совпадение приходилось бы фронту. Здесь ровно один пользователь или 404.
   */
  async findByUserName(viewerId: string, userName: string): Promise<UserBriefDto> {
    const user = await this.prisma.user.findFirst({
      where: {
        userName: { equals: userName, mode: Prisma.QueryMode.insensitive },
        isDeleted: false,
      },
      select: USER_BRIEF,
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    // Блокировка прячет профиль так же, как в search() — иначе by-username стал бы
    // обходным путём вокруг блока.
    const hidden = await this.access.blockedIds(viewerId);
    if (hidden.includes(user.id)) throw new NotFoundException('Пользователь не найден');

    return this.toBrief(user);
  }

  // ─────────────── история поиска: текстовая ───────────────

  async addSearchText(userId: string, text: string): Promise<SearchHistoryItemDto> {
    const row = await this.prisma.searchHistory.create({
      data: { userId, text },
      select: { id: true, text: true, createdAt: true },
    });
    return row;
  }

  async getSearchText(userId: string): Promise<SearchHistoryItemDto[]> {
    // createdAt отдаём всегда — без него фронт не может показать «недавние» (баг softclub #19).
    return this.prisma.searchHistory.findMany({
      where: { userId },
      select: { id: true, text: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async deleteSearchText(userId: string, id: string): Promise<DeletedCountDto> {
    // deleteMany с userId в условии = проверка владения: чужую запись не удалить.
    const { count } = await this.prisma.searchHistory.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Запись истории поиска не найдена');
    return { deleted: count };
  }

  async clearSearchText(userId: string): Promise<DeletedCountDto> {
    const { count } = await this.prisma.searchHistory.deleteMany({ where: { userId } });
    return { deleted: count };
  }

  // ─────────────── история поиска: юзеры ───────────────

  async addSearchedUser(userId: string, searchedUserId: string): Promise<SearchedUserItemDto> {
    if (userId === searchedUserId) {
      throw new BadRequestException('Нельзя добавить себя в историю поиска');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: searchedUserId, isDeleted: false },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Пользователь не найден');

    // @@unique([userId, searchedUserId]): повторный клик по тому же профилю не плодит строки,
    // а поднимает запись наверх — как в IG.
    const row = await this.prisma.userSearchHistory.upsert({
      where: { userId_searchedUserId: { userId, searchedUserId } },
      create: { userId, searchedUserId },
      update: { createdAt: new Date() },
      select: {
        id: true,
        createdAt: true,
        searchedUser: { select: USER_BRIEF },
      },
    });
    return { id: row.id, createdAt: row.createdAt, user: this.toBrief(row.searchedUser) };
  }

  async getSearchedUsers(userId: string): Promise<SearchedUserItemDto[]> {
    const rows = await this.prisma.userSearchHistory.findMany({
      where: { userId, searchedUser: { isDeleted: false } },
      select: { id: true, createdAt: true, searchedUser: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      user: this.toBrief(r.searchedUser),
    }));
  }

  async deleteSearchedUser(userId: string, id: string): Promise<DeletedCountDto> {
    const { count } = await this.prisma.userSearchHistory.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Запись истории поиска не найдена');
    return { deleted: count };
  }

  async clearSearchedUsers(userId: string): Promise<DeletedCountDto> {
    const { count } = await this.prisma.userSearchHistory.deleteMany({ where: { userId } });
    return { deleted: count };
  }

  // ─────────────── рекомендации ───────────────

  /**
   * «Рекомендации для вас»: те, на кого подписаны мои подписки, но я — ещё нет.
   * followedBy — имена общих подписок, из них фронт строит «Подписаны: m.ibrohim».
   */
  async suggestions(viewerId: string, limit = 10): Promise<SuggestionDto[]> {
    const myFollowing = await this.prisma.follow.findMany({
      where: { followerId: viewerId, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
    });
    const myFollowingIds = myFollowing.map((f) => f.followingId);
    const hidden = await this.access.blockedIds(viewerId);

    // Кого читают мои подписки (второй круг).
    const secondCircle = await this.prisma.follow.findMany({
      where: {
        followerId: { in: myFollowingIds },
        status: FollowStatus.ACCEPTED,
        followingId: { notIn: [viewerId, ...myFollowingIds, ...hidden] },
        following: { isDeleted: false },
      },
      select: {
        followingId: true,
        follower: { select: { userName: true } },
      },
    });

    // Группируем: кандидат → кто из моих подписок на него подписан.
    const byCandidate = new Map<string, string[]>();
    for (const row of secondCircle) {
      const list = byCandidate.get(row.followingId) ?? [];
      list.push(row.follower.userName);
      byCandidate.set(row.followingId, list);
    }

    // Сначала те, у кого больше общих подписок.
    const ranked = [...byCandidate.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, limit);

    if (ranked.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: ranked.map(([id]) => id) } },
      select: USER_BRIEF,
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return ranked.flatMap(([id, names]) => {
      const user = userById.get(id);
      if (!user) return [];
      return [
        {
          ...this.toBrief(user),
          followedBy: names.slice(0, FOLLOWED_BY_PREVIEW),
          followedByCount: names.length,
        },
      ];
    });
  }

  // ─────────────── жалоба и удаление аккаунта ───────────────

  async report(reporterId: string, targetId: string, reason: string): Promise<ReportCreatedDto> {
    if (reporterId === targetId) throw new BadRequestException('Нельзя пожаловаться на себя');

    const target = await this.prisma.user.findFirst({
      where: { id: targetId, isDeleted: false },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Пользователь не найден');

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        targetType: ReportTargetType.USER,
        targetId,
        reason,
      },
      select: { id: true, targetType: true, targetId: true },
    });
    return { ...report, message: 'Жалоба отправлена, мы её рассмотрим' };
  }

  /**
   * Soft-delete: 30 дней на восстановление (ТЗ §7). Строку НЕ трогаем физически —
   * иначе каскадом снесло бы посты, чаты и переписку у собеседников.
   */
  async softDeleteMe(userId: string): Promise<AccountDeletedDto> {
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: { isDeleted: true, deletedAt: now },
    });
    // Все сессии гасим сразу, иначе действующий access-токен ещё 15 минут пускал бы в аккаунт.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });

    const restorableUntil = new Date(now.getTime() + SOFT_DELETE_DAYS * 24 * 60 * 60 * 1000);
    return {
      restorableUntil,
      message: `Аккаунт удалён. Восстановить можно в течение ${SOFT_DELETE_DAYS} дней`,
    };
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
