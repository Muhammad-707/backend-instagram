import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { ValidatedFile } from './file-validator';
import { ProcessedMedia } from './storage.types';

/** Длинная сторона фото после ресайза — как в IG. */
const IMAGE_MAX_SIDE = 1440;
const IMAGE_QUALITY = 82;
/** Постер видео берём с 0.1 с: на 0.0 часто чёрный кадр. */
const POSTER_AT_SEC = 0.1;
const POSTER_MAX_SIDE = 720;

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor() {
    if (!ffmpegPath) throw new Error('ffmpeg-static: бинарь не найден');
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobeStatic.path);
  }

  async process(v: ValidatedFile): Promise<ProcessedMedia> {
    switch (v.kind) {
      case 'IMAGE':
        return this.processImage(v);
      case 'VIDEO':
        return this.processVideo(v);
      case 'AUDIO':
        return this.processAudio(v);
    }
  }

  /** Ресайз до 1440 по длинной стороне, конверт в webp. EXIF (включая GPS) вырезается. */
  private async processImage(v: ValidatedFile): Promise<ProcessedMedia> {
    // sharp по умолчанию НЕ переносит метаданные в выходной файл: не вызываем .withMetadata() —
    // и EXIF, GPS-координаты и прочее не попадают в webp.
    const pipeline = sharp(v.file.buffer, { failOn: 'error' })
      .rotate() // применяем EXIF-ориентацию ДО того, как её выбросим, иначе фото ляжет боком
      .resize({
        width: IMAGE_MAX_SIDE,
        height: IMAGE_MAX_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: IMAGE_QUALITY });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      ext: 'webp',
      mime: 'image/webp',
      width: info.width,
      height: info.height,
    };
  }

  /**
   * Видео не перекодируем (это дорого и долго — сожмём в BullMQ-задаче при необходимости),
   * но снимаем метаданные и генерируем постер кадром на 0.1 с.
   */
  private async processVideo(v: ValidatedFile): Promise<ProcessedMedia> {
    const src = await this.toTempFile(v.file.buffer, v.ext);
    try {
      const meta = await this.probe(src);
      const poster = await this.extractPoster(src);
      return {
        buffer: v.file.buffer,
        ext: v.ext,
        mime: v.mime,
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        thumb: { buffer: poster, ext: 'webp', mime: 'image/webp' },
      };
    } finally {
      await fs.rm(src, { force: true });
    }
  }

  /** Аудио отдаём как есть, но с честной длительностью — она нужна для полосы голосового. */
  private async processAudio(v: ValidatedFile): Promise<ProcessedMedia> {
    const src = await this.toTempFile(v.file.buffer, v.ext);
    try {
      const meta = await this.probe(src);
      return {
        buffer: v.file.buffer,
        ext: v.ext,
        mime: v.mime,
        duration: meta.duration,
      };
    } finally {
      await fs.rm(src, { force: true });
    }
  }

  private probe(path: string): Promise<{ width?: number; height?: number; duration?: number }> {
    return new Promise((resolve, reject) => {
      // fluent-ffmpeg типизирует err как any — сужаем сами.
      ffmpeg.ffprobe(path, (err: unknown, data) => {
        if (err) {
          const msg = err instanceof Error ? err.message : 'неизвестная ошибка ffprobe';
          return reject(new BadRequestException(`Не удалось прочитать медиафайл: ${msg}`));
        }
        const streams = (data.streams ?? []) as FfprobeStream[];
        const video = streams.find((s) => s.codec_type === 'video');
        const duration = data.format?.duration;
        resolve({
          width: video?.width,
          height: video?.height,
          duration: typeof duration === 'number' ? Number(duration.toFixed(2)) : undefined,
        });
      });
    });
  }

  private async extractPoster(src: string): Promise<Buffer> {
    const out = join(tmpdir(), `poster-${randomUUID()}.png`);
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(src)
          .seekInput(POSTER_AT_SEC)
          .frames(1)
          .output(out)
          .on('end', () => resolve())
          .on('error', (err: Error) =>
            reject(new BadRequestException(`Не удалось снять постер видео: ${err.message}`)),
          )
          .run();
      });
      const raw = await fs.readFile(out);
      return sharp(raw)
        .resize({
          width: POSTER_MAX_SIDE,
          height: POSTER_MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: IMAGE_QUALITY })
        .toBuffer();
    } finally {
      await fs.rm(out, { force: true });
    }
  }

  private async toTempFile(buffer: Buffer, ext: string): Promise<string> {
    const path = join(tmpdir(), `upload-${randomUUID()}.${ext}`);
    await fs.writeFile(path, buffer);
    return path;
  }
}
