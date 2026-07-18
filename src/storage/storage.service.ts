import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { MediaKind } from './storage.types';

const FOLDER: Readonly<Record<MediaKind, string>> = {
  IMAGE: 'images',
  VIDEO: 'videos',
  AUDIO: 'audio',
};

/**
 * Map Cloudinary resource formats back to MIME types.
 * Cloudinary returns `format` (e.g. "webp", "mp4") instead of MIME.
 */
const FORMAT_TO_MIME: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
};

/**
 * Map MediaKind → Cloudinary resource_type for uploads.
 * 'raw' is used for audio because Cloudinary treats non-image/video as raw files.
 */
const KIND_TO_RESOURCE_TYPE: Record<MediaKind, string> = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'raw',
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly cloudName: string;

  constructor(private readonly config: ConfigService) {
    this.cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME', 'your_cloud_name');
  }

  /** Не роняем API, если Cloudinary недоступен — как и PrismaService: пусть /api/health честно скажет. */
  async onModuleInit(): Promise<void> {
    try {
      await cloudinary.api.ping();
      this.logger.log('Cloudinary connected · ping OK');
    } catch (e) {
      this.logger.error(`Cloudinary init failed: ${(e as Error).message}`);
    }
  }

  async ping(): Promise<boolean> {
    const result = await cloudinary.api.ping();
    return result?.status === 'ok';
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
    const publicId = this.stripExtension(key);
    const resourceType = this.guessResourceType(mime);

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: resourceType as 'image' | 'video' | 'raw' | 'auto',
          overwrite: true,
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result!);
        },
      );
      stream.end(buffer);
    });

    this.logger.debug(`Uploaded ${key} → ${result.secure_url}`);
    return key;
  }

  async remove(key: string): Promise<void> {
    const publicId = this.stripExtension(key);
    // Try all resource types — we don't always know which type it is.
    for (const type of ['image', 'video', 'raw'] as const) {
      try {
        const result = await cloudinary.uploader.destroy(publicId, { resource_type: type });
        if (result.result === 'ok') return;
      } catch {
        // Try next type
      }
    }
    // If none succeeded, the resource may already be deleted. Don't throw —
    // mirror the old MinIO behavior where removing a non-existent key is safe.
    this.logger.warn(`remove(${key}): resource not found in any type — may already be deleted`);
  }

  async exists(key: string): Promise<boolean> {
    const publicId = this.stripExtension(key);
    for (const type of ['image', 'video', 'raw'] as const) {
      try {
        await cloudinary.api.resource(publicId, { resource_type: type });
        return true;
      } catch {
        // Try next type
      }
    }
    return false;
  }

  /**
   * Публичная ссылка из того, что лежит в БД.
   *
   * Принимает ключ ИЛИ старый абсолютный URL: во втором случае, если это
   * Cloudinary URL, извлекает ключ и пересобирает. Если это чужая ссылка
   * (picsum/pravatar из сидов) — отдаёт как есть.
   */
  publicUrlFor(value: string | null | undefined): string | null {
    if (!value) return null;
    // Чужая ссылка (picsum/pravatar из сидов) — отдаём как есть, не трогаем.
    if (/^https?:\/\//i.test(value) && !this.isOwnUrl(value)) return value;

    const key = this.keyFromUrl(value);
    if (!key) return value;

    const publicId = this.stripExtension(key);
    const ext = this.getExtension(key);
    const resourceType = this.guessResourceTypeFromExt(ext);

    return cloudinary.url(publicId, {
      resource_type: resourceType,
      secure: true,
      format: ext,
    });
  }

  /** Размер и mime объекта — нужны, чтобы посчитать Content-Range до чтения тела. */
  async stat(key: string): Promise<{ size: number; mime: string }> {
    const publicId = this.stripExtension(key);
    const ext = this.getExtension(key);
    const resourceType = this.guessResourceTypeFromExt(ext);

    const info = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
    });

    const mime = FORMAT_TO_MIME[info.format] ?? 'application/octet-stream';
    return { size: info.bytes, mime };
  }

  /** Весь объект потоком. */
  async getStream(key: string): Promise<Readable> {
    const url = this.buildRawUrl(key);
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Cloudinary fetch failed for ${key}: ${response.status}`);
    }
    return Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  }

  /**
   * Кусок объекта потоком — для Range-запросов.
   * Читаем ровно запрошенный диапазон, а не весь файл: иначе перемотка трека
   * тянула бы все 9 МБ с самого начала.
   */
  async getPartialStream(key: string, offset: number, length: number): Promise<Readable> {
    const url = this.buildRawUrl(key);
    const end = offset + length - 1;
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${end}` },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Cloudinary partial fetch failed for ${key}: ${response.status}`);
    }
    return Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  }

  /**
   * Ссылка ведёт в НАШЕ хранилище (Cloudinary)?
   *
   * Признак «наше» — cloud name в URL. В БД лежат и чужие абсолютные URL —
   * сиды заполняют аватары и медиа картинками с i.pravatar.cc и picsum.photos.
   */
  private isOwnUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return (
        url.hostname.includes('cloudinary.com') && url.pathname.includes(`/${this.cloudName}/`)
      );
    } catch {
      return false;
    }
  }

  /**
   * Ключ из того, что лежит в БД: принимает и ключ (новый формат), и наш
   * абсолютный Cloudinary URL. Для чужой ссылки — null.
   */
  keyFromUrl(value: string): string | null {
    if (!value) return null;
    if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, ''); // уже ключ
    if (!this.isOwnUrl(value)) return null;

    try {
      const url = new URL(value);
      const path = url.pathname;
      // Cloudinary URL format: /cloud_name/resource_type/upload/v.../public_id.ext
      const marker = `/${this.cloudName}/`;
      const idx = path.indexOf(marker);
      if (idx < 0) return null;

      const afterCloud = path.slice(idx + marker.length);
      // Skip resource_type/upload/vNNN/ prefix
      const parts = afterCloud.split('/');
      // Find the index after "upload" and version segments
      let startIdx = 0;
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === 'upload') {
          startIdx = i + 1;
          // Skip version if present (v1234567890)
          if (startIdx < parts.length && /^v\d+$/.test(parts[startIdx])) {
            startIdx++;
          }
          break;
        }
      }
      if (startIdx === 0) {
        // No "upload" found — skip resource_type and take the rest
        startIdx = 1;
      }
      return parts.slice(startIdx).join('/');
    } catch {
      return null;
    }
  }

  /** Временная ссылка на приватный объект (Cloudinary signed URL). */
  async presignedUrl(key: string, ttlSec: number = 3600): Promise<string> {
    const publicId = this.stripExtension(key);
    const ext = this.getExtension(key);
    const resourceType = this.guessResourceTypeFromExt(ext);

    const expiresAt = Math.floor(Date.now() / 1000) + ttlSec;

    return cloudinary.url(publicId, {
      resource_type: resourceType,
      secure: true,
      format: ext,
      sign_url: true,
      type: 'authenticated',
      expires_at: expiresAt,
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Strip file extension from a key to get the Cloudinary public_id. */
  private stripExtension(key: string): string {
    const dotIdx = key.lastIndexOf('.');
    return dotIdx > 0 ? key.slice(0, dotIdx) : key;
  }

  /** Get file extension from a key. */
  private getExtension(key: string): string {
    const dotIdx = key.lastIndexOf('.');
    return dotIdx > 0 ? key.slice(dotIdx + 1) : '';
  }

  /** Guess Cloudinary resource_type from MIME type. */
  private guessResourceType(mime: string): 'image' | 'video' | 'raw' {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    return 'raw'; // audio and everything else
  }

  /** Guess Cloudinary resource_type from file extension. */
  private guessResourceTypeFromExt(ext: string): 'image' | 'video' | 'raw' {
    const mime = FORMAT_TO_MIME[ext];
    if (mime) return this.guessResourceType(mime);
    // Fallback based on common folder prefixes in keys
    return 'image';
  }

  /**
   * Build a direct Cloudinary URL for streaming/fetching.
   * Uses the key to determine resource type and constructs the URL.
   */
  private buildRawUrl(key: string): string {
    const publicId = this.stripExtension(key);
    const ext = this.getExtension(key);
    const resourceType = this.guessResourceTypeFromExt(ext);

    return cloudinary.url(publicId, {
      resource_type: resourceType,
      secure: true,
      format: ext,
    });
  }
}
