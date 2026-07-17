import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CursorDto } from '../../../common/pagination/cursor.dto';

export class SearchMusicDto extends CursorDto {
  @ApiPropertyOptional({
    example: 'lofi',
    description: 'Подстрока — ищет и в title, и в artist (регистронезависимо)',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: 'Lo-Fi' })
  @IsOptional()
  @IsString()
  genre?: string;
}

export class MusicDto {
  @ApiProperty({ example: 7 })
  id!: number;

  @ApiProperty({ example: 'Midnight Drive' })
  title!: string;

  @ApiProperty({ example: 'Coma-Media' })
  artist!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'http://localhost:3000/api/music/7/stream',
    description:
      'Наш стриминг с поддержкой Range (перемотка). Есть, только если mp3 лежит у нас. ' +
      'У трека из внешнего каталога — null: полного файла нет, и этот роут ответил бы 404.',
  })
  streamUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Что реально играет у внешнего трека — 30-сек превью каталога.',
  })
  previewUrl?: string | null;

  @ApiProperty({
    example: true,
    description: 'true — играется целиком (наш mp3); false — только 30-сек превью',
  })
  isFullTrack!: boolean;

  @ApiProperty({ example: 'http://localhost:9000/instagram/covers/2026/07/abc.webp' })
  coverUrl!: string;

  @ApiProperty({ example: 218, description: 'Длительность в секундах (посчитана ffprobe)' })
  duration!: number;

  @ApiPropertyOptional({ type: String, example: 'Lo-Fi', nullable: true })
  genre?: string | null;

  @ApiProperty({ example: false })
  isTrending!: boolean;

  @ApiProperty({ example: 42, description: 'Сколько раз использован в постах/историях' })
  usesCount!: number;

  @ApiProperty({ example: false, description: 'Сохранён ли мной' })
  isSaved!: boolean;
}

export class SaveMusicDto {
  @ApiProperty({ example: true, description: 'true — сохранён, false — убран из сохранённых' })
  saved!: boolean;

  @ApiProperty({ example: 'Трек сохранён' })
  message!: string;
}
