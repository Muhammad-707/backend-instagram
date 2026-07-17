import { Module } from '@nestjs/common';
import { MusicModule } from '../music/music.module';
import { SpotifyController } from './spotify.controller';

@Module({
  // Вся логика каталогов живёт в MusicModule (OnlineMusicService + провайдеры).
  // Здесь остались только Spotify-специфичные роуты ради совместимости.
  imports: [MusicModule],
  controllers: [SpotifyController],
})
export class SpotifyModule {}
