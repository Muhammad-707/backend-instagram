import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../../common/access/access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CloseFriendDto, OkMessageDto } from '../follow/dto/follow.dto';

@Injectable()
export class CloseFriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(userId: string): Promise<CloseFriendDto[]> {
    const rows = await this.prisma.closeFriend.findMany({
      where: { userId, friend: { isDeleted: false } },
      select: {
        createdAt: true,
        friend: {
          select: {
            id: true,
            userName: true,
            fullName: true,
            isVerified: true,
            isPrivate: true,
            profile: { select: { avatarUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.friend.id,
      userName: r.friend.userName,
      fullName: r.friend.fullName,
      avatarUrl: r.friend.profile?.avatarUrl ?? null,
      isVerified: r.friend.isVerified,
      isPrivate: r.friend.isPrivate,
      addedAt: r.createdAt,
    }));
  }

  async add(userId: string, friendId: string): Promise<OkMessageDto> {
    if (userId === friendId) {
      throw new BadRequestException('Нельзя добавить себя в близкие друзья');
    }
    // Заблокированного в близкие друзья не берём — иначе он получил бы доступ
    // к историям «только для близких».
    await this.access.assertNotBlocked(userId, friendId);

    const friend = await this.prisma.user.findFirst({
      where: { id: friendId, isDeleted: false },
      select: { id: true },
    });
    if (!friend) throw new NotFoundException('Пользователь не найден');

    // Идемпотентно: повторное добавление — не ошибка.
    await this.prisma.closeFriend.upsert({
      where: { userId_friendId: { userId, friendId } },
      create: { userId, friendId },
      update: {},
    });
    return { message: 'Добавлен в близкие друзья' };
  }

  async remove(userId: string, friendId: string): Promise<OkMessageDto> {
    await this.prisma.closeFriend.deleteMany({ where: { userId, friendId } });
    return { message: 'Удалён из близких друзей' };
  }
}
