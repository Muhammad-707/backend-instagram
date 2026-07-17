import { Module } from '@nestjs/common';
import { SpotifyModule } from '../spotify/spotify.module';
import { NotesController } from './notes.controller';
import { NotesCron } from './notes.cron';
import { NotesService } from './notes.service';

@Module({
  // Заметка может нести трек прямо из Spotify (обложка + название) — импортируем его в Music.
  imports: [SpotifyModule],
  controllers: [NotesController],
  providers: [NotesService, NotesCron],
  exports: [NotesService],
})
export class NotesModule {}
