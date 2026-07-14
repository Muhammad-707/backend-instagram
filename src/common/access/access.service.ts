import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FollowStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Единая точка правды по «кто кого может видеть»: блокировки + приватность.
 * Держим отдельно от модулей, потому что этим пользуются users, profile, follow,
 * а дальше — posts, stories, chat. В Фазе 4б поверх этого встанут BlockGuard и PrivacyGuard.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Блокировка симметрична по последствиям: неважно, кто кого заблокировал — контент скрыт обоим. */
  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { id: true },
    });
    return block !== null;
  }

  /** id всех, с кем у меня блокировка в любую сторону — чтобы вырезать их из поиска и рекомендаций. */
  async blockedIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.blockerId === userId ? r.blockedId : r.blockerId);
    }
    return [...ids];
  }

  async assertNotBlocked(viewerId: string, targetId: string): Promise<void> {
    if (await this.isBlockedBetween(viewerId, targetId)) {
      // 403, а не 404: врать «нет такого юзера» не нужно, но и содержимое не отдаём.
      throw new ForbiddenException('Доступ к этому аккаунту закрыт');
    }
  }

  /** Принятая подписка viewer → target. */
  async isFollowing(viewerId: string, targetId: string): Promise<boolean> {
    const f = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: viewerId, followingId: targetId } },
      select: { status: true },
    });
    return f?.status === FollowStatus.ACCEPTED;
  }

  /**
   * Можно ли смотреть КОНТЕНТ (посты, истории) пользователя.
   * Сам профиль (аватар, счётчики) у приватного аккаунта виден всем — как в IG;
   * закрыты именно посты. Блокировка закрывает всё.
   */
  async canViewContent(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    if (await this.isBlockedBetween(viewerId, targetId)) return false;

    const target = await this.prisma.user.findFirst({
      where: { id: targetId, isDeleted: false },
      select: { isPrivate: true },
    });
    if (!target) throw new NotFoundException('Пользователь не найден');
    if (!target.isPrivate) return true;

    return this.isFollowing(viewerId, targetId);
  }

  async assertCanViewContent(viewerId: string, targetId: string): Promise<void> {
    if (!(await this.canViewContent(viewerId, targetId))) {
      throw new ForbiddenException('Аккаунт закрыт — подпишитесь, чтобы видеть публикации');
    }
  }
}
