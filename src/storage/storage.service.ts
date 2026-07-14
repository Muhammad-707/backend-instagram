import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { MediaKind } from './storage.types';

/** Presigned-ссылка на приватный объект живёт 1 час. */
const PRESIGNED_TTL_SEC = 3600;

const FOLDER: Readonly<Record<MediaKind, string>> = {
  IMAGE: 'images',
  VIDEO: 'videos',
  AUDIO: 'audio',
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: MinioClient;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET', 'instagram');
    this.publicUrl = this.config
      .get<string>('S3_PUBLIC_URL', 'http://localhost:9000/instagram')
      .replace(/\/+$/, '');
    this.client = new MinioClient({
      endPoint: this.config.get<string>('S3_ENDPOINT', 'localhost'),
      port: Number(this.config.get<string>('S3_PORT', '9000')),
      useSSL: this.config.get<string>('S3_USE_SSL', 'false') === 'true',
      accessKey: this.config.get<string>('S3_ACCESS_KEY', 'minioadmin'),
      secretKey: this.config.get<string>('S3_SECRET_KEY', 'minioadmin'),
    });
  }

  /** Не роняем API, если MinIO недоступен — как и PrismaService: пусть /api/health честно скажет. */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket();
      this.logger.log(`MinIO connected · bucket «${this.bucket}» готов`);
    } catch (e) {
      this.logger.error(`MinIO init failed: ${(e as Error).message}`);
    }
  }

  async ping(): Promise<boolean> {
    return this.client.bucketExists(this.bucket);
  }

  private async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket, 'us-east-1');
      this.logger.log(`Bucket «${this.bucket}» создан`);
    }
    // Медиа Instagram отдаётся напрямую по ссылке (<img src>), поэтому объекты
    // читаются анонимно. Запись — только через API с ключами.
    await this.client.setBucketPolicy(
      this.bucket,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucket}/*`],
          },
        ],
      }),
    );
  }

  /** Ключ вида `images/2026/07/uuid.webp` — раскладка по месяцам, чтобы не было папки на миллион файлов. */
  buildKey(kind: MediaKind, ext: string): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${FOLDER[kind]}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
  }

  async put(key: string, buffer: Buffer, mime: string): Promise<string> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return this.publicUrlFor(key);
  }

  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  publicUrlFor(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  /** Временная ссылка на приватный объект (пригодится, если закроем bucket в проде). */
  presignedUrl(key: string, ttlSec: number = PRESIGNED_TTL_SEC): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, ttlSec);
  }
}
