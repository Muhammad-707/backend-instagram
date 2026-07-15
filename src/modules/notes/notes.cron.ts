import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Заметки живут 24ч. В отличие от историй, у заметок нет медиа в S3 и нет «актуального»,
 * поэтому достаточно простого cron'а раз в час — BullMQ-задача на каждую заметку избыточна.
 * Сообщения-ответы в чате при этом остаются (noteSnapshot хранит превью).
 */
@Injectable()
export class NotesCron {
  private readonly logger = new Logger(NotesCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired(): Promise<void> {
    const { count } = await this.prisma.note.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    if (count > 0) this.logger.log(`Cron: удалено истёкших заметок — ${count}`);
  }
}
