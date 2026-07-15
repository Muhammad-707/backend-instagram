import { Module } from '@nestjs/common';
import { HighlightsController } from './highlights.controller';
import { HighlightsService } from './highlights.service';
import { StoriesController } from './stories.controller';
import { StoriesCron } from './stories.cron';
import { StoriesProcessor } from './stories.processor';
import { StoriesService } from './stories.service';

@Module({
  controllers: [StoriesController, HighlightsController],
  providers: [StoriesService, HighlightsService, StoriesProcessor, StoriesCron],
  exports: [StoriesService],
})
export class StoriesModule {}
