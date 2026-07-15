import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

/**
 * Онлайн-статус. Живёт в Redis с TTL: сокет шлёт heartbeat каждые 30с, ключ живёт 60с.
 * Пропустил два heartbeat — считаешься офлайн. lastSeenAt дублируется в Postgres,
 * чтобы «был в сети N мин назад» переживал перезапуск Redis.
 */
const PRESENCE_TTL_SEC = 60;
const key = (userId: string): string => `presence:${userId}`;

@Injectable()
export class PresenceService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** Юзер подключился/прислал heartbeat — продлеваем ключ. */
  async touch(userId: string): Promise<void> {
    await this.redis.set(key(userId), Date.now().toString(), PRESENCE_TTL_SEC);
  }

  /** Ушёл офлайн — фиксируем lastSeenAt в БД и убираем из Redis. */
  async goOffline(userId: string): Promise<void> {
    await this.redis.del(key(userId));
    await this.prisma.presence.upsert({
      where: { userId },
      create: { userId, isOnline: false, lastSeenAt: new Date() },
      update: { isOnline: false, lastSeenAt: new Date() },
    });
  }

  async isOnline(userId: string): Promise<boolean> {
    return this.redis.exists(key(userId));
  }

  /** Пачкой — для списка чатов, без N запросов в Redis. */
  async onlineMap(userIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    await Promise.all(
      userIds.map(async (id) => {
        result.set(id, await this.redis.exists(key(id)));
      }),
    );
    return result;
  }

  /** lastSeenAt из БД (для офлайн-пользователей). */
  async lastSeen(userId: string): Promise<Date | null> {
    const p = await this.prisma.presence.findUnique({
      where: { userId },
      select: { lastSeenAt: true },
    });
    return p?.lastSeenAt ?? null;
  }
}
