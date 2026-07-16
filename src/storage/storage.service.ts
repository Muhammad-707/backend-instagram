import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
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

  /**
   * Возвращает КЛЮЧ, а не URL — и в БД кладётся именно ключ.
   *
   * Раньше put() отдавал абсолютный URL, и он же сохранялся. Из-за этого смена
   * домена ломала не только картинки: keyFromUrl() сравнивал строку через
   * startsWith(текущий base) и на старых записях возвращал null — а значит,
   * перставали работать стрим музыки и удаление файлов, а не только <img>.
   * Ключ такой привязки к домену не имеет; URL собирается при отдаче.
   */
  async put(key: string, buffer: Buffer, mime: string): Promise<string> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return key;
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

  /**
   * Публичная ссылка из того, что лежит в БД.
   *
   * Принимает ключ ИЛИ старый абсолютный URL: во втором случае берёт из него
   * ключ и пересобирает ссылку на ТЕКУЩИЙ S3_PUBLIC_URL. Благодаря этому
   * записи с `http://localhost:9000/...`, уже лежащие в базе, отдаются с
   * рабочего домена без миграции данных — а миграция лишь наводит порядок.
   */
  publicUrlFor(value: string | null | undefined): string | null {
    if (!value) return null;
    // Чужая ссылка (picsum/pravatar из сидов) — отдаём как есть, не трогаем.
    if (/^https?:\/\//i.test(value) && !this.isOwnUrl(value)) return value;

    const key = this.keyFromUrl(value);
    return key ? `${this.publicUrl}/${key}` : value;
  }

  /** Размер и mime объекта — нужны, чтобы посчитать Content-Range до чтения тела. */
  async stat(key: string): Promise<{ size: number; mime: string }> {
    const info = await this.client.statObject(this.bucket, key);
    // minio типизирует metaData как индексируемый any — сужаем сами.
    const meta: Record<string, string | undefined> = info.metaData;
    return {
      size: info.size,
      mime: meta['content-type'] ?? 'application/octet-stream',
    };
  }

  /** Весь объект потоком. */
  getStream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  /**
   * Кусок объекта потоком — для Range-запросов.
   * Читаем ровно запрошенный диапазон, а не весь файл: иначе перемотка трека
   * тянула бы все 9 МБ с самого начала.
   */
  getPartialStream(key: string, offset: number, length: number): Promise<Readable> {
    return this.client.getPartialObject(this.bucket, key, offset, length);
  }

  /**
   * Ссылка ведёт в НАШЕ хранилище?
   *
   * В БД лежат и чужие абсолютные URL — сиды заполняют аватары и медиа
   * картинками с i.pravatar.cc и picsum.photos. Их нельзя ни разбирать на
   * ключи, ни пересобирать на свой домен: `https://picsum.photos/seed/x/1080`
   * превратился бы в `https://<наш-s3>/seed/x/1080`, и все эти картинки просто
   * умерли бы.
   *
   * Признак «наше» — имя бакета в пути (переживает смену домена) либо текущий
   * base. Ограничение: если публичный домен без бакета в пути (напр. R2
   * `https://cdn.example.com/<key>`) сменится, старые строки станут «чужими» и
   * останутся как есть. Для новых записей это неважно — в БД уже ключ.
   */
  private isOwnUrl(value: string): boolean {
    if (`${value}/`.startsWith(`${this.publicUrl}/`)) return true;
    try {
      return new URL(value).pathname.includes(`/${this.bucket}/`);
    } catch {
      return false;
    }
  }

  /**
   * Ключ из того, что лежит в БД: принимает и ключ (новый формат), и наш
   * абсолютный URL (записи до перехода на ключи, в т.ч. с localhost:9000).
   *
   * Для чужой ссылки — null: удалять картинку picsum из своего S3 нечего.
   * Сравнения с текущим base здесь нет намеренно — именно оно ломало старые
   * записи после переезда домена.
   */
  keyFromUrl(value: string): string | null {
    if (!value) return null;
    if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, ''); // уже ключ
    if (!this.isOwnUrl(value)) return null;

    let path: string;
    try {
      path = new URL(value).pathname;
    } catch {
      return null;
    }

    const marker = `/${this.bucket}/`;
    const at = path.indexOf(marker);
    return at >= 0 ? path.slice(at + marker.length) : path.replace(/^\/+/, '');
  }

  /** Временная ссылка на приватный объект (пригодится, если закроем bucket в проде). */
  presignedUrl(key: string, ttlSec: number = PRESIGNED_TTL_SEC): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, ttlSec);
  }
}
