import { Module } from '@nestjs/common';
import { MusicModule } from '../music/music.module';
import { HighlightsController } from './highlights.controller';
import { HighlightsService } from './highlights.service';
import { StoriesController } from './stories.controller';
import { StoriesCron } from './stories.cron';
import { StoriesProcessor } from './stories.processor';
import { StoriesService } from './stories.service';

@Module({
  // Трек в истории: импорт из каталога + честный ответ про воспроизведение.
  imports: [MusicModule],
  controllers: [StoriesController, HighlightsController],
  providers: [StoriesService, HighlightsService, StoriesProcessor, StoriesCron],
  exports: [StoriesService],
})
export class StoriesModule {}
