import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FollowStatus, NotifType, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { buildCursorPage, CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import {
  BlockedUserDto,
  FollowerDto,
  FollowRequestDto,
  FollowResultDto,
  OkMessageDto,
} from './dto/follow.dto';
import { UserBriefDto } from '../users/dto/users.dto';

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
export class FollowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly events: EventEmitter2,
  ) {}

  // ─────────────── подписка ───────────────

  async follow(followerId: string, followingId: string): Promise<FollowResultDto> {
    if (followerId === followingId) {
      throw new BadRequestException('Нельзя подписаться на себя');
    }
    await this.access.assertNotBlocked(followerId, followingId);

    const target = await this.prisma.user.findFirst({
      where: { id: followingId, isDeleted: false },
      select: { isPrivate: true },
    });
    if (!target) throw new NotFoundException('Пользователь не найден');

    const existing = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
      select: { status: true },
    });
    if (existing) {
      // Идемпотентно: повторное нажатие не плодит заявки и не сбрасывает статус.
      return this.result(existing.status, 'Вы уже подписаны или заявка уже отправлена');
    }

    // Публичный → сразу ACCEPTED. Приватный → PENDING, ждёт подтверждения владельца.
    const status = target.isPrivate ? FollowStatus.PENDING : FollowStatus.ACCEPTED;

    await this.prisma.follow.create({ data: { followerId, followingId, status } });

    // Разные типы: на заявку жмут «Подтвердить», на подписку — нет.
    this.events.emit(NOTIFY_EVENT, {
      userId: followingId,
      actorId: followerId,
      type: target.isPrivate ? NotifType.FOLLOW_REQUEST : NotifType.FOLLOW,
    } satisfies NotifyPayload);

    return this.result(
      status,
      target.isPrivate ? 'Заявка отправлена — аккаунт закрытый' : 'Вы подписались',
    );
  }

  async unfollow(followerId: string, followingId: string): Promise<OkMessageDto> {
    // deleteMany — идемпотентно: отписка от того, на кого не подписан, не должна падать.
    await this.prisma.follow.deleteMany({ where: { followerId, followingId } });
    return { message: 'Вы отписались' };
  }

  // ─────────────── заявки ───────────────

  async requests(userId: string, dto: CursorDto): Promise<CursorPage<FollowRequestDto>> {
    const rows = await this.prisma.follow.findMany({
      where: { followingId: userId, status: FollowStatus.PENDING },
      select: { id: true, createdAt: true, follower: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });
    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return {
      ...page,
      items: page.items.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        user: this.toBrief(r.follower),
      })),
    };
  }

  async accept(userId: string, requestId: string): Promise<OkMessageDto> {
    const req = await this.loadOwnRequest(userId, requestId);

    await this.prisma.follow.update({
      where: { id: req.id },
      data: { status: FollowStatus.ACCEPTED },
    });
    // Уведомляем того, кто просился: «вашу заявку приняли».
    this.events.emit(NOTIFY_EVENT, {
      userId: req.followerId,
      actorId: userId,
      type: NotifType.FOLLOW_ACCEPTED,
    } satisfies NotifyPayload);
    return { message: 'Заявка принята' };
  }

  async decline(userId: string, requestId: string): Promise<OkMessageDto> {
    const req = await this.loadOwnRequest(userId, requestId);
    // Отклонённую заявку удаляем, а не храним как DECLINED: иначе повторно подписаться
    // было бы нельзя (@@unique на паре), и человек навсегда остался бы отвергнутым.
    await this.prisma.follow.delete({ where: { id: req.id } });
    return { message: 'Заявка отклонена' };
  }

  /** Заявка должна быть адресована именно мне — иначе чужие заявки можно было бы принимать. */
  private async loadOwnRequest(
    userId: string,
    requestId: string,
  ): Promise<{ id: string; followerId: string }> {
    const req = await this.prisma.follow.findUnique({
      where: { id: requestId },
      select: { id: true, followerId: true, followingId: true, status: true },
    });
    if (!req || req.status !== FollowStatus.PENDING) {
      throw new NotFoundException('Заявка не найдена');
    }
    if (req.followingId !== userId) {
      throw new ForbiddenException('Это не ваша заявка');
    }
    return { id: req.id, followerId: req.followerId };
  }

  // ─────────────── списки ───────────────

  async followers(
    viewerId: string,
    targetId: string,
    dto: CursorDto,
  ): Promise<CursorPage<FollowerDto>> {
    // Список подписчиков — тоже контент: у закрытого аккаунта его видят только свои.
    await this.access.assertCanViewContent(viewerId, targetId);

    const rows = await this.prisma.follow.findMany({
      where: { followingId: targetId, status: FollowStatus.ACCEPTED },
      select: { id: true, follower: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });
    return this.pageOfUsers(viewerId, rows, dto.limit, (r) => r.follower);
  }

  async following(
    viewerId: string,
    targetId: string,
    dto: CursorDto,
  ): Promise<CursorPage<FollowerDto>> {
    await this.access.assertCanViewContent(viewerId, targetId);

    const rows = await this.prisma.follow.findMany({
      where: { followerId: targetId, status: FollowStatus.ACCEPTED },
      select: { id: true, following: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });
    return this.pageOfUsers(viewerId, rows, dto.limit, (r) => r.following);
  }

  /** «Удалить подписчика» — убираю ЕГО подписку на МЕНЯ (не свою на него). */
  async removeFollower(userId: string, followerId: string): Promise<OkMessageDto> {
    const { count } = await this.prisma.follow.deleteMany({
      where: { followerId, followingId: userId },
    });
    if (count === 0) throw new NotFoundException('Этот пользователь на вас не подписан');
    return { message: 'Подписчик удалён' };
  }

  // ─────────────── блокировки ───────────────

  async block(blockerId: string, blockedId: string): Promise<OkMessageDto> {
    if (blockerId === blockedId) throw new BadRequestException('Нельзя заблокировать себя');

    const target = await this.prisma.user.findFirst({
      where: { id: blockedId, isDeleted: false },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Пользователь не найден');

    await this.prisma.$transaction([
      this.prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      }),
      // Блокировка рвёт подписки в ОБЕ стороны — как в IG.
      this.prisma.follow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      }),
      // И убирает из близких друзей — иначе он видел бы «только для друзей» истории.
      this.prisma.closeFriend.deleteMany({
        where: {
          OR: [
            { userId: blockerId, friendId: blockedId },
            { userId: blockedId, friendId: blockerId },
          ],
        },
      }),
    ]);
    return { message: 'Пользователь заблокирован' };
  }

  async unblock(blockerId: string, blockedId: string): Promise<OkMessageDto> {
    await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    // Подписки НЕ восстанавливаем: разблокировка ≠ возврат подписки (как в IG).
    return { message: 'Пользователь разблокирован' };
  }

  async blocked(userId: string, dto: CursorDto): Promise<CursorPage<BlockedUserDto>> {
    const rows = await this.prisma.block.findMany({
      where: { blockerId: userId },
      select: { id: true, createdAt: true, blocked: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });
    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return {
      ...page,
      items: page.items.map((r) => ({ ...this.toBrief(r.blocked), blockedAt: r.createdAt })),
    };
  }

  // ─────────────── helpers ───────────────

  /** Проставляет isFollowedByMe одним запросом на всю страницу — без N+1. */
  private async pageOfUsers<T extends { id: string }>(
    viewerId: string,
    rows: T[],
    limit: number,
    pick: (row: T) => UserBriefRow,
  ): Promise<CursorPage<FollowerDto>> {
    const page = buildCursorPage(rows, limit, (r) => r.id);
    const users = page.items.map(pick);

    const myFollows = await this.prisma.follow.findMany({
      where: {
        followerId: viewerId,
        followingId: { in: users.map((u) => u.id) },
        status: FollowStatus.ACCEPTED,
      },
      select: { followingId: true },
    });
    const followed = new Set(myFollows.map((f) => f.followingId));

    return {
      ...page,
      items: users.map((u) => ({ ...this.toBrief(u), isFollowedByMe: followed.has(u.id) })),
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

  private result(status: FollowStatus, message: string): FollowResultDto {
    return {
      status,
      isFollowing: status === FollowStatus.ACCEPTED,
      hasRequestPending: status === FollowStatus.PENDING,
      message,
    };
  }
}
