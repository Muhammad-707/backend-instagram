import { Module } from '@nestjs/common';
import { MusicModule } from '../music/music.module';
import { SettingsModule } from '../settings/settings.module';
import { CommentsService } from './comments.service';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  // Трек в посте: OnlineMusicService импортирует найденный в каталоге трек,
  // AttachedMusicService строит честный ответ (streamUrl только если файл наш).
  // SettingsModule — политики «кто может отмечать/упоминать/комментировать».
  imports: [MusicModule, SettingsModule],
  controllers: [PostsController],
  providers: [PostsService, CommentsService],
  exports: [PostsService, CommentsService],
})
export class PostsModule {}
