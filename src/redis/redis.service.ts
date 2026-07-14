import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    this.client.on('error', (err: Error) => this.logger.error(`Redis: ${err.message}`));
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Redis connected');
    } catch (e) {
      this.logger.error(`Redis connect failed: ${(e as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }

  get raw(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    const pong = await this.client.ping();
    return pong === 'PONG';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const value = await this.client.incr(key);
    if (ttlSeconds && value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }
}
