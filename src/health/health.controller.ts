import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { HealthDto } from './dto/health.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Проверка API, БД и Redis' })
  @ApiOkResponse({ type: HealthDto })
  async check(): Promise<HealthDto> {
    const [db, cache] = await Promise.all([
      this.safe(() => this.prisma.ping()),
      this.safe(() => this.redis.ping()),
    ]);
    return {
      status: db && cache ? 'ok' : 'degraded',
      database: db ? 'up' : 'down',
      redis: cache ? 'up' : 'down',
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  private async safe(fn: () => Promise<boolean>): Promise<boolean> {
    try {
      return await fn();
    } catch {
      return false;
    }
  }
}
