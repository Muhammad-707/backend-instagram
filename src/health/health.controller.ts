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

    const reasons: Record<string, string> = {};
    if (db.error) reasons.database = db.error;
    if (cache.error) reasons.redis = cache.error;
    if (files.error) reasons.storage = files.error;

    const allUp = db.ok && cache.ok && files.ok;
    return {
      status: allUp ? 'ok' : 'degraded',
      database: db.ok ? 'up' : 'down',
      redis: cache.ok ? 'up' : 'down',
      storage: files.ok ? 'up' : 'down',
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      ...(allUp ? {} : { reasons }),
    };
  }

  private async safe(fn: () => Promise<boolean>): Promise<{ ok: boolean; error?: string }> {
    try {
      return { ok: await withTimeout(fn()) };
    } catch (e) {
      return { ok: false, error: redact((e as Error).message) };
    }
  }
}

/**
 * Бе ин timeout /health ҳангоми афтидани сервис умуман ҷавоб намедиҳад.
 * Санҷида шуд: `docker stop ig_redis` → ioredis retryStrategy беохир такрор
 * мекунад, `ping()` барнамегардад ва дархост меовезад. Яъне маҳз вақте ки
 * health лозим аст, он кор намекунад. Пас ҳар санҷиш маҳдудияти сахт дорад.
 */
const CHECK_TIMEOUT_MS = 3000;

function withTimeout(promise: Promise<boolean>): Promise<boolean> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`пайваст дар ${CHECK_TIMEOUT_MS} мс ҷавоб надод (timeout)`)),
      CHECK_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Матни хатогӣ метавонад credential ва хостро дар бар гирад
 * (масалан `postgresql://ig:parol@db.host:5432/...` дар хатогии Prisma).
 * /health публикӣ аст (@Public) — пас пеш аз ирсол пок мекунем:
 * сабаб мемонад, суроға ва парол не.
 */
function redact(message: string): string {
  return (
    message
      // `scheme://user:pass@host:port` — тамоми credential+host
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s`'"]+/gi, '***')
      // IP:port ё host:port -и урён
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '***')
      .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/gi, '***')
      // мундариҷаи backtick-и Prisma: Can't reach database server at `host:port`
      .replace(/`[^`]*`/g, '`***`')
      .slice(0, 300)
  );
}
