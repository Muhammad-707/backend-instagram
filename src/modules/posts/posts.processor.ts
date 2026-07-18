import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PostStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { POSTS_QUEUE, PublishScheduledPostPayload } from '../../jobs/jobs.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { PostsService } from './posts.service';

/**
 * Публикует отложенный пост в назначенное время — задача ставится с delay при создании
 * (POST /posts со status=SCHEDULED). Идемпотентна: если пост уже опубликован/удалён — ничего.
 */
@Processor(POSTS_QUEUE)
export class PostsProcessor extends WorkerHost {
  private readonly logger = new Logger(PostsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posts: PostsService,
  ) {
    super();
  }

  async process(job: Job<PublishScheduledPostPayload>): Promise<void> {
    const { postId } = job.data;
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { status: true, scheduledAt: true },
    });
    if (!post || post.status !== PostStatus.SCHEDULED) return; // уже опубликован/удалён

    // Защита от преждевременного запуска — если срок не наступил, перепланируем.
    if (post.scheduledAt && post.scheduledAt > new Date()) {
      throw new Error(
        `Рано: до публикации ${Math.round((post.scheduledAt.getTime() - Date.now()) / 1000)}с`,
      );
    }

    await this.posts.publishScheduled(postId);
    this.logger.log(`Отложенный пост ${postId} опубликован`);
  }
}
