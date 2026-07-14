import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaKind } from '../../../storage/storage.types';

export class UploadedMediaDto {
  @ApiProperty({
    example: 'images/2026/07/6f1c9e1a-2b3d-4c5e-8a7b-9d0e1f2a3b4c.webp',
    description: 'Ключ объекта в S3 — им же удаляют файл через DELETE /upload/:key',
  })
  key!: string;

  @ApiProperty({ example: 'http://localhost:9000/instagram/images/2026/07/6f1c9e1a.webp' })
  url!: string;

  @ApiProperty({ enum: ['IMAGE', 'VIDEO', 'AUDIO'], example: 'IMAGE' })
  type!: MediaKind;

  @ApiProperty({ example: 'image/webp', description: 'Определён по magic bytes, не по расширению' })
  mime!: string;

  @ApiProperty({ example: 184320, description: 'Размер после обработки, байты' })
  size!: number;

  @ApiPropertyOptional({ example: 1440 })
  width?: number;

  @ApiPropertyOptional({ example: 1080 })
  height?: number;

  @ApiPropertyOptional({ example: 12.34, description: 'Секунды — для VIDEO и AUDIO' })
  duration?: number;

  @ApiPropertyOptional({ description: 'Постер видео (кадр 0.1 с)' })
  thumbUrl?: string;

  @ApiPropertyOptional({ description: 'Ключ постера — удаляется вместе с видео' })
  thumbKey?: string;
}

export class DeletedKeyDto {
  @ApiProperty({ example: 'images/2026/07/6f1c9e1a.webp' })
  key!: string;

  @ApiProperty({ example: true })
  deleted!: boolean;
}
