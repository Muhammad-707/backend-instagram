import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesCron } from './notes.cron';
import { NotesService } from './notes.service';

@Module({
  controllers: [NotesController],
  providers: [NotesService, NotesCron],
  exports: [NotesService],
})
export class NotesModule {}
