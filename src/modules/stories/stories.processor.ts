import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { DeleteExpiredStoryPayload, STORIES_QUEUE } from '../../jobs/jobs.constants';

/**
 * Удаляет истёкшую историю через 24ч — задача ставится с delay при создании.
 * ВАЖНО: история, попавшая в «Актуальное» (Highlight), НЕ удаляется — иначе highlight
 * стал бы пустым. Поэтому перед удалением проверяем связь HighlightStory.
 */
@Processor(STORIES_QUEUE)
export class StoriesProcessor extends WorkerHost {
  private readonly logger = new Logger(StoriesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<DeleteExpiredStoryPayload>): Promise<void> {
    const { storyId } = job.data;

    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: {
        mediaUrl: true,
        thumbUrl: true,
        expiresAt: true,
        _count: { select: { highlights: true } },
      },
    });

    // Уже удалена — задача не нужна.
    if (!story) return;

    // В «Актуальном» — оставляем жить.
    if (story._count.highlights > 0) {
      this.logger.log(`История ${storyId} в актуальном — не удаляем`);
      return;
    }

    // Защита от преждевременного запуска: если срок ещё не наступил — перепланируем.
    if (story.expiresAt > new Date()) {
      const delay = story.expiresAt.getTime() - Date.now();
      throw new Error(`Рано: до истечения ещё ${Math.round(delay / 1000)}с`);
    }

    await this.prisma.story.delete({ where: { id: storyId } });

    for (const url of [story.mediaUrl, story.thumbUrl]) {
      const key = url ? this.storage.keyFromUrl(url) : null;
      if (key) await this.storage.remove(key).catch(() => undefined);
    }
    this.logger.log(`История ${storyId} удалена по истечении 24ч`);
  }
}
