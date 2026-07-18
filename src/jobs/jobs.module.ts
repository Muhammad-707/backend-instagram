import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { POSTS_QUEUE, STORIES_QUEUE } from './jobs.constants';

/**
 * @Global — очередь историй нужна StoriesService (продюсер) и процессору (консьюмер).
 * Подключение к Redis берём из REDIS_URL, тот же, что у RedisService.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get<string>('REDIS_URL', 'redis://localhost:6379'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
          },
        };
      },
    }),
    BullModule.registerQueue({ name: STORIES_QUEUE }),
    BullModule.registerQueue({ name: POSTS_QUEUE }),
  ],
  exports: [BullModule],
})
export class JobsModule {}
