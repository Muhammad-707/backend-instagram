import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FileValidator } from './file-validator';
import { MediaService } from './media.service';
import { MediaUrlInterceptor } from './media-url.interceptor';
import { StorageService } from './storage.service';

/** @Global — storage нужен постам, историям, чату, музыке и аватарам. */
@Global()
@Module({
  providers: [
    StorageService,
    MediaService,
    FileValidator,
    // Через APP_INTERCEPTOR, а не useGlobalInterceptors в main.ts: нужен
    // StorageService из DI. Он окажется «внутри» ResponseInterceptor, то есть
    // отработает на сырых данных — до того, как их завернут в конверт.
    { provide: APP_INTERCEPTOR, useClass: MediaUrlInterceptor },
  ],
  exports: [StorageService, MediaService, FileValidator],
})
export class StorageModule {}
