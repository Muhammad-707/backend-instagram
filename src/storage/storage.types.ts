/** Вид загружаемого файла. IMAGE/VIDEO совпадают с Prisma-enum MediaType, AUDIO — голосовые и музыка. */
export type MediaKind = 'IMAGE' | 'VIDEO' | 'AUDIO';

/** Файл, пришедший из Multer (memoryStorage — всегда с buffer). */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Результат обработки и заливки одного файла. */
export interface StoredMedia {
  key: string;
  url: string;
  type: MediaKind;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** Длительность в секундах — для VIDEO и AUDIO. */
  duration?: number;
  /** Постер видео (кадр 0.1 с), webp. */
  thumbUrl?: string;
  thumbKey?: string;
}

/** Обработанный медиа-буфер до заливки в S3. */
export interface ProcessedMedia {
  buffer: Buffer;
  ext: string;
  mime: string;
  width?: number;
  height?: number;
  duration?: number;
  thumb?: { buffer: Buffer; ext: string; mime: string };
}
