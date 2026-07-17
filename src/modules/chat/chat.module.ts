import { Module } from '@nestjs/common';
import { SpotifyModule } from '../spotify/spotify.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  // Отправка трека в чат по spotifyId импортирует его в нашу Music (MUSIC_SHARE).
  imports: [SpotifyModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
