import { Module } from '@nestjs/common';
import { MusicModule } from '../music/music.module';
import { SettingsModule } from '../settings/settings.module';
import { HighlightsController } from './highlights.controller';
import { HighlightsService } from './highlights.service';
import { StoriesController } from './stories.controller';
import { StoriesCron } from './stories.cron';
import { StoriesProcessor } from './stories.processor';
import { StoriesService } from './stories.service';
import { StoryStickersController } from './story-stickers.controller';
import { StoryStickersService } from './story-stickers.service';

@Module({
  // Трек в истории: импорт из каталога + честный ответ про воспроизведение.
  // SettingsModule — упоминания в истории уважают «кто может @упоминать меня».
  imports: [MusicModule, SettingsModule],
  controllers: [StoriesController, HighlightsController, StoryStickersController],
  providers: [
    StoriesService,
    HighlightsService,
    StoriesProcessor,
    StoriesCron,
    StoryStickersService,
  ],
  exports: [StoriesService],
})
export class StoriesModule {}
