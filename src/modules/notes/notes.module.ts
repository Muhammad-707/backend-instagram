import { Module } from '@nestjs/common';
import { MusicModule } from '../music/music.module';
import { NotesController } from './notes.controller';
import { NotesCron } from './notes.cron';
import { NotesService } from './notes.service';

@Module({
  // Заметка может нести трек из любого каталога (обложка + название) — импортируем его в Music.
  imports: [MusicModule],
  controllers: [NotesController],
  providers: [NotesService, NotesCron],
  exports: [NotesService],
})
export class NotesModule {}
