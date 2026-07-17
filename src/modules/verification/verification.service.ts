import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { NotifType, PaymentProvider, PaymentStatus, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VerificationStatusDto } from './dto/verification.dto';

const DAY_MS = 86_400_000;
const TRIAL_DAYS = 7;
const PERIOD_DAYS = 30;
const PRICE_USD = 10;

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async status(userId: string): Promise<VerificationStatusDto> {
    const [user, v] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isVerified: true } }),
      this.prisma.verification.findUnique({ where: { userId } }),
    ]);
    if (!v) {
      return {
        status: null,
        isVerified: user.isVerified,
        trialUsed: false,
        daysLeft: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        priceUsd: PRICE_USD,
        trialDays: TRIAL_DAYS,
      };
    }
    const end = v.status === VerificationStatus.TRIAL ? v.trialEndsAt : v.currentPeriodEnd;
    return {
      status: v.status,
      isVerified: user.isVerified,
      trialUsed: v.trialUsed,
      daysLeft: this.daysLeft(end),
      trialEndsAt: v.trialEndsAt,
      currentPeriodEnd: v.currentPeriodEnd,
      priceUsd: PRICE_USD,
      trialDays: TRIAL_DAYS,
    };
  }

  /** Бесплатный триал 7 дней — ровно один раз на аккаунт. */
  async startTrial(userId: string): Promise<VerificationStatusDto> {
    const existing = await this.prisma.verification.findUnique({ where: { userId } });
    if (existing?.trialUsed) {
      throw new BadRequestException('Пробный период уже использован');
    }
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * DAY_MS);
    await this.prisma.$transaction([
      this.prisma.verification.upsert({
        where: { userId },
        create: {
          userId,
          status: VerificationStatus.TRIAL,
          trialUsed: true,
          trialEndsAt,
          priceUsd: PRICE_USD,
        },
        update: { status: VerificationStatus.TRIAL, trialUsed: true, trialEndsAt },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { isVerified: true } }),
    ]);
    return this.status(userId);
  }

  /** Mock-платёж $1000/мес: Payment(PAID, MOCK) + период на 30 дней. */
  async subscribe(userId: string): Promise<VerificationStatusDto> {
    const currentPeriodEnd = new Date(Date.now() + PERIOD_DAYS * DAY_MS);
    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          userId,
          amountUsd: PRICE_USD,
          provider: PaymentProvider.MOCK,
          status: PaymentStatus.PAID,
        },
      }),
      this.prisma.verification.upsert({
        where: { userId },
        create: {
          userId,
          status: VerificationStatus.ACTIVE,
          currentPeriodEnd,
          priceUsd: PRICE_USD,
        },
        update: { status: VerificationStatus.ACTIVE, currentPeriodEnd },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { isVerified: true } }),
    ]);
    return this.status(userId);
  }

  /** Отмена: галочка держится до конца оплаченного периода, снимет её cron. */
  async cancel(userId: string): Promise<VerificationStatusDto> {
    const v = await this.prisma.verification.findUnique({ where: { userId } });
    if (!v || v.status === VerificationStatus.EXPIRED || v.status === VerificationStatus.CANCELED) {
      throw new BadRequestException('Активной подписки нет');
    }
    await this.prisma.verification.update({
      where: { userId },
      data: { status: VerificationStatus.CANCELED },
    });
    return this.status(userId);
  }

  /**
   * Ежедневная развёртка (вызывается cron'ом и тестом):
   *   1) за 1 день до конца триала → уведомление VERIFICATION_TRIAL_ENDING;
   *   2) истёкший триал без оплаты и истёкший период → снимаем галочку, status=EXPIRED.
   */
  async sweepExpired(): Promise<{ notified: number; expired: number }> {
    const now = new Date();
    const in1Day = new Date(now.getTime() + DAY_MS);

    const ending = await this.prisma.verification.findMany({
      where: { status: VerificationStatus.TRIAL, trialEndsAt: { gt: now, lte: in1Day } },
      select: { userId: true },
    });
    for (const e of ending) {
      await this.notifications.notifySystem(e.userId, NotifType.VERIFICATION_TRIAL_ENDING);
    }

    const expiredTrials = await this.prisma.verification.findMany({
      where: { status: VerificationStatus.TRIAL, trialEndsAt: { lte: now } },
      select: { userId: true },
    });
    const expiredSubs = await this.prisma.verification.findMany({
      where: {
        status: { in: [VerificationStatus.ACTIVE, VerificationStatus.CANCELED] },
        currentPeriodEnd: { lte: now },
      },
      select: { userId: true },
    });
    const expiredIds = [...expiredTrials, ...expiredSubs].map((x) => x.userId);

    if (expiredIds.length > 0) {
      await this.prisma.$transaction([
        this.prisma.verification.updateMany({
          where: { userId: { in: expiredIds } },
          data: { status: VerificationStatus.EXPIRED },
        }),
        this.prisma.user.updateMany({
          where: { id: { in: expiredIds } },
          data: { isVerified: false },
        }),
      ]);
    }

    const result = { notified: ending.length, expired: expiredIds.length };
    if (result.notified || result.expired) {
      this.logger.log(`Verification sweep: notified=${result.notified}, expired=${result.expired}`);
    }
    return result;
  }

  private daysLeft(end: Date | null): number | null {
    if (!end) return null;
    const ms = end.getTime() - Date.now();
    return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
  }
}
