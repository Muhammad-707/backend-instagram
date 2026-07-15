import { Module } from '@nestjs/common';
import { MusicModule } from '../music/music.module';
import { SpotifyController } from './spotify.controller';
import { SpotifyService } from './spotify.service';

@Module({
  // MusicModule экспортирует MusicService — переиспользуем его save/unsave/byId,
  // чтобы сохранённый трек Spotify вёл себя ровно как локальный.
  imports: [MusicModule],
  controllers: [SpotifyController],
  providers: [SpotifyService],
})
export class SpotifyModule {}
