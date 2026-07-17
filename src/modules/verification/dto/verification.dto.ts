import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';

export class VerificationStatusDto {
  @ApiPropertyOptional({
    enum: VerificationStatus,
    nullable: true,
    description: 'null — верификация ни разу не оформлялась',
    example: VerificationStatus.TRIAL,
  })
  status!: VerificationStatus | null;

  @ApiProperty({ example: true, description: 'Стоит ли синяя галочка прямо сейчас' })
  isVerified!: boolean;

  @ApiProperty({ example: false, description: 'Использован ли бесплатный триал (даётся 1 раз)' })
  trialUsed!: boolean;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 6,
    description: 'Дней до конца триала/периода',
  })
  daysLeft!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  trialEndsAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  currentPeriodEnd!: Date | null;

  @ApiProperty({ example: 10, description: 'Цена подписки в $/мес (после 7 дней бесплатного триала)' })
  priceUsd!: number;

  @ApiProperty({ example: 7, description: 'Сколько дней бесплатного триала даётся' })
  trialDays!: number;
}
