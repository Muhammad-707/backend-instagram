import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { HealthDto } from './dto/health.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Проверка API, БД, Redis и MinIO' })
  @ApiOkResponse({ type: HealthDto })
  async check(): Promise<HealthDto> {
    const [db, cache, files] = await Promise.all([
      this.safe(() => this.prisma.ping()),
      this.safe(() => this.redis.ping()),
      this.safe(() => this.storage.ping()),
    ]);
    return {
      status: db && cache && files ? 'ok' : 'degraded',
      database: db ? 'up' : 'down',
      redis: cache ? 'up' : 'down',
      storage: files ? 'up' : 'down',
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
