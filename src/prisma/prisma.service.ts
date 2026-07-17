import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    // Не роняем API, если БД недоступна: /api/health должен ответить database: "down"
    try {
      await this.$connect();
      this.logger.log('Prisma connected');
    } catch (e) {
      this.logger.error(`Prisma connect failed: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Для /api/health.
   *
   * Намеояд танҳо `SELECT 1`: он фақат пайвастро месанҷад ва ҷадвал талаб
   * намекунад. Дар прод БД бе миграция буд — `SELECT 1` мегузашт, health
   * `database: up` менавишт, вале ҳар дархости воқеӣ 500 медод. Healthcheck
   * набояд «up» гӯяд, агар API кор карда натавонад.
   *
   * Барои ҳамин ба ҷадвали воқеӣ мезанем: агар схема набошад, Prisma P2021
   * медиҳад ва health рост «down» мегӯяд.
   */
  async ping(): Promise<boolean> {
    await this.user.findFirst({ select: { id: true } });
    return true;
  }
}
