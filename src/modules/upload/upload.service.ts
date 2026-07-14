import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FileValidator } from '../../storage/file-validator';
import { MediaService } from '../../storage/media.service';
import { StorageService } from '../../storage/storage.service';
import { StoredMedia, UploadedFile } from '../../storage/storage.types';

const MAX_FILES = 10;

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly validator: FileValidator,
  ) {}

  async uploadMany(files: UploadedFile[]): Promise<StoredMedia[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Не передан ни один файл (поле «files»)');
    }
    if (files.length > MAX_FILES) {
      throw new BadRequestException(`Максимум ${MAX_FILES} файлов за раз, пришло ${files.length}`);
    }

    // Сначала валидируем ВСЕ файлы и только потом заливаем: иначе при плохом 5-м файле
    // первые четыре уже осели бы в S3 мусором.
    const validated = await Promise.all(files.map((f) => this.validator.validate(f)));

    const stored: StoredMedia[] = [];
    try {
      for (const v of validated) {
        stored.push(await this.storeOne(v));
      }
    } catch (e) {
      // Частичная загрузка = мусор в S3. Откатываем всё, что успели залить.
      await this.cleanup(stored);
      throw e;
    }
    return stored;
  }

  private async storeOne(v: Awaited<ReturnType<FileValidator['validate']>>): Promise<StoredMedia> {
    const processed = await this.media.process(v);
    const key = this.storage.buildKey(v.kind, processed.ext);
    const url = await this.storage.put(key, processed.buffer, processed.mime);

    const result: StoredMedia = {
      key,
      url,
      type: v.kind,
      mime: processed.mime,
      size: processed.buffer.length,
      width: processed.width,
      height: processed.height,
      duration: processed.duration,
    };

    if (processed.thumb) {
      const thumbKey = this.storage.buildKey('IMAGE', processed.thumb.ext);
      result.thumbUrl = await this.storage.put(
        thumbKey,
        processed.thumb.buffer,
        processed.thumb.mime,
      );
      result.thumbKey = thumbKey;
    }
    return result;
  }

  async remove(key: string): Promise<void> {
    if (!(await this.storage.exists(key))) {
      throw new NotFoundException(`Файл «${key}» не найден`);
    }
    await this.storage.remove(key);
  }

  private async cleanup(stored: StoredMedia[]): Promise<void> {
    for (const s of stored) {
      const keys = s.thumbKey ? [s.key, s.thumbKey] : [s.key];
      for (const key of keys) {
        try {
          await this.storage.remove(key);
        } catch (e) {
          this.logger.error(`Откат: не удалось удалить «${key}»: ${(e as Error).message}`);
        }
      }
    }
  }
}
