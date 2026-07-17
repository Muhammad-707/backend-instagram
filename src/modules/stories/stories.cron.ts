import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Подстраховка к BullMQ: раз в час подчищает истёкшие истории, которые НЕ в «Актуальном».
 * Нужна на случай, если Redis был недоступен в момент создания и задача не встала,
 * либо процесс перезапускался. BullMQ — основной путь, cron — сеть безопасности.
 */
@Injectable()
export class StoriesCron {
  private readonly logger = new Logger(StoriesCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired(): Promise<void> {
    const expired = await this.prisma.story.findMany({
      where: {
        expiresAt: { lte: new Date() },
        // В актуальном — не трогаем.
        highlights: { none: {} },
        // Включён архив — не трогаем: истёкшая история живёт в GET /stories/archive.
        saveToArchive: false,
      },
      select: { id: true, mediaUrl: true, thumbUrl: true },
      take: 500,
    });
    if (expired.length === 0) return;

    for (const s of expired) {
      await this.prisma.story.delete({ where: { id: s.id } }).catch(() => undefined);
      for (const url of [s.mediaUrl, s.thumbUrl]) {
        const key = url ? this.storage.keyFromUrl(url) : null;
        if (key) await this.storage.remove(key).catch(() => undefined);
      }
    }
    this.logger.log(`Cron: удалено истёкших историй — ${expired.length}`);
  }
}
