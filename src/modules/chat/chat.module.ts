import { Module } from '@nestjs/common';
import { MusicModule } from '../music/music.module';
import { SettingsModule } from '../settings/settings.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  // Отправка трека в чат: OnlineMusicService импортирует его в нашу Music (MUSIC_SHARE).
  // SettingsModule — «кто может писать мне» (иначе сообщение уходит в запросы).
  imports: [MusicModule, SettingsModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
