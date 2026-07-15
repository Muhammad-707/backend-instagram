import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VerificationService } from './verification.service';

/** Раз в сутки: предупреждение за день до конца триала + снятие галочки у истёкших. */
@Injectable()
export class VerificationCron {
  constructor(private readonly verification: VerificationService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async daily(): Promise<void> {
    await this.verification.sweepExpired();
  }
}
