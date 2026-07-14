import { Global, Module } from '@nestjs/common';
import { FileValidator } from './file-validator';
import { MediaService } from './media.service';
import { StorageService } from './storage.service';

/** @Global — storage нужен постам, историям, чату, музыке и аватарам. */
@Global()
@Module({
  providers: [StorageService, MediaService, FileValidator],
  exports: [StorageService, MediaService, FileValidator],
})
export class StorageModule {}
