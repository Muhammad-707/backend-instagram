import { Module } from '@nestjs/common';
import { AccessModule } from '../../common/access/access.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Настройки аккаунта. Экспортирует SettingsService — его дёргают posts/chat/
 * stories для проверки политик (canTag/canMention/canComment/canMessage).
 */
@Module({
  imports: [AccessModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
