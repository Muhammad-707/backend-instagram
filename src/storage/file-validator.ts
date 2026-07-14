import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as FileType from 'file-type';
import { MediaKind, UploadedFile } from './storage.types';

/** Whitelist из ТЗ §6: jpeg/png/webp · mp4/mov · mp3/m4a. Ключ — реальный mime из magic bytes. */
const MIME_WHITELIST: Readonly<Record<string, MediaKind>> = {
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/webp': 'IMAGE',
  'video/mp4': 'VIDEO',
  'video/quicktime': 'VIDEO', // .mov
  'audio/mpeg': 'AUDIO', // .mp3
  'audio/mp4': 'AUDIO', // .m4a
  'audio/x-m4a': 'AUDIO',
};

export interface ValidatedFile {
  file: UploadedFile;
  kind: MediaKind;
  /** Настоящий mime, определённый по содержимому файла. */
  mime: string;
  ext: string;
}

@Injectable()
export class FileValidator {
  private readonly logger = new Logger(FileValidator.name);
  private readonly limits: Readonly<Record<MediaKind, number>>;

  constructor(private readonly config: ConfigService) {
    const mb = (key: string, def: number): number =>
      Number(this.config.get<string>(key, String(def))) * 1024 * 1024;
    this.limits = {
      IMAGE: mb('MAX_IMAGE_MB', 10),
      VIDEO: mb('MAX_VIDEO_MB', 100),
      AUDIO: mb('MAX_AUDIO_MB', 20),
    };
  }

  /**
   * Определяет тип по magic bytes (первым байтам содержимого), а НЕ по расширению
   * и НЕ по mimetype из заголовка — их клиент может подделать (ТЗ §6).
   */
  async validate(file: UploadedFile): Promise<ValidatedFile> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(`Файл «${file.originalname}» пустой`);
    }

    const detected = await FileType.fromBuffer(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        `Не удалось определить тип файла «${file.originalname}» по содержимому`,
      );
    }

    const kind = MIME_WHITELIST[detected.mime];
    if (!kind) {
      throw new BadRequestException(
        `Тип «${detected.mime}» не разрешён. Можно: jpeg, png, webp, mp4, mov, mp3, m4a`,
      );
    }

    // Заголовок соврал о типе — не падаем, но пишем в лог: содержимое всё равно главнее.
    if (file.mimetype !== detected.mime) {
      this.logger.warn(
        `mime подменён: заголовок «${file.mimetype}», по содержимому «${detected.mime}» (${file.originalname})`,
      );
    }

    const limit = this.limits[kind];
    if (file.size > limit) {
      throw new BadRequestException(
        `Файл «${file.originalname}» — ${this.mb(file.size)} МБ, лимит для ${kind}: ${this.mb(limit)} МБ`,
      );
    }

    return { file, kind, mime: detected.mime, ext: detected.ext };
  }

  private mb(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1);
  }
}
