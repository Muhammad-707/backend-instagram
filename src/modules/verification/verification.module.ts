import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationCron } from './verification.cron';
import { VerificationService } from './verification.service';

/** NotificationsService берётся из @Global NotificationsModule (для VERIFICATION_TRIAL_ENDING). */
@Module({
  controllers: [VerificationController],
  providers: [VerificationService, VerificationCron],
  exports: [VerificationService],
})
export class VerificationModule {}
