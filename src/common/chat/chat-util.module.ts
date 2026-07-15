import { Global, Module } from '@nestjs/common';
import { ChatUtilService } from './chat-util.service';

/** @Global — findOrCreateDirectChat нужен posts, stories, notes, а дальше и chat-модулю. */
@Global()
@Module({
  providers: [ChatUtilService],
  exports: [ChatUtilService],
})
export class ChatUtilModule {}
