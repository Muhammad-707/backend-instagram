import { forwardRef, Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { AttachedMusicService } from './attached-music.service';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';
import { DeezerService } from './online/deezer.service';
import { OnlineMusicController } from './online/online-music.controller';
import { OnlineMusicService } from './online/online-music.service';
import { SpotifyService } from './online/spotify.service';

@Module({
  // PostsModule (forwardRef — Posts тоже импортирует Music): «Use this audio»
  // отдаёт reels через PostsService.
  imports: [forwardRef(() => PostsModule)],
  // OnlineMusicService — поиск «любой песни мира» во внешних каталогах.
  // Экспортируется: чат и заметки прикрепляют найденный трек по (provider, externalId).
  // OnlineMusicController — ПЕРВЫМ: у MusicController есть `GET /music/:id`, и
  // при обратном порядке он перехватывал бы `/music/online` (id=«online» →
  // «numeric string is expected», 400). Конкретный путь должен идти до параметра.
  controllers: [OnlineMusicController, MusicController],
  providers: [
    MusicService,
    DeezerService,
    SpotifyService,
    OnlineMusicService,
    AttachedMusicService,
  ],
  exports: [MusicService, OnlineMusicService, AttachedMusicService],
})
export class MusicModule {}
