import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { v2 as cloudinary } from 'cloudinary';
import { FileValidator } from './file-validator';
import { MediaService } from './media.service';
import { MediaUrlInterceptor } from './media-url.interceptor';
import { StorageService } from './storage.service';

/**
 * Cloudinary v2.config() запускается при инициализации модуля.
 * Провайдер зарегистрирован вручную, чтобы env-переменные прочитались
 * через ConfigService (а не через process.env до старта ConfigModule).
 */
const CLOUDINARY_PROVIDER = {
  provide: 'CLOUDINARY',
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    cloudinary.config({
      cloud_name: config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: config.get<string>('CLOUDINARY_API_KEY'),
      api_secret: config.get<string>('CLOUDINARY_API_SECRET'),
    });
    return cloudinary;
  },
};

/** @Global — storage нужен постам, историям, чату, музыке и аватарам. */
@Global()
@Module({
  providers: [
    CLOUDINARY_PROVIDER,
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
