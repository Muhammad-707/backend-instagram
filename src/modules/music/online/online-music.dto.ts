import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MusicProvider } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class SearchOnlineMusicDto {
  @ApiProperty({ example: 'weeknd blinding lights', description: 'Название или исполнитель' })
  @IsString()
  @IsNotEmpty({ message: 'q: запрос не может быть пустым' })
  q!: string;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    enum: MusicProvider,
    description: 'Искать в конкретном каталоге. По умолчанию — в первом доступном.',
  })
  @IsOptional()
  @IsEnum(MusicProvider)
  provider?: MusicProvider;
}

export class SaveOnlineTrackDto {
  @ApiProperty({ enum: MusicProvider, example: MusicProvider.DEEZER })
  @IsEnum(MusicProvider)
  provider!: MusicProvider;

  @ApiProperty({ example: '908604612', description: 'id трека в каталоге провайдера' })
  @IsString()
  @IsNotEmpty()
  externalId!: string;
}

export class OnlineTrackDto {
  @ApiProperty({ enum: MusicProvider, example: MusicProvider.DEEZER })
  provider!: MusicProvider;

  @ApiProperty({ example: '908604612', description: 'id трека в каталоге провайдера' })
  externalId!: string;

  @ApiProperty({ example: 'Blinding Lights' })
  title!: string;

  @ApiProperty({ example: 'The Weeknd' })
  artist!: string;

  @ApiProperty({ example: 'https://.../cover.jpg', description: 'Обложка альбома' })
  coverUrl!: string;

  @ApiProperty({ example: 200, description: 'Длительность трека, сек' })
  duration!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      '30-сек превью (mp3). Полного трека внешние каталоги не отдают — ни Spotify, ни Deezer. ' +
      'null — каталог не дал даже превью.',
  })
  previewUrl?: string | null;

  @ApiProperty({ example: 'https://www.deezer.com/track/908604612' })
  pageUrl!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Наш Music.id, если трек уже импортирован. null — ещё не импортирован.',
  })
  musicId?: number | null;

  @ApiProperty({ example: false, description: 'Уже в моих сохранённых' })
  isSaved!: boolean;
}

export class OnlineProvidersDto {
  @ApiProperty({
    enum: MusicProvider,
    isArray: true,
    example: [MusicProvider.DEEZER],
    description:
      'Каталоги, которые реально доступны сейчас. Spotify появится здесь, только когда его ' +
      '/search перестанет отвечать 403 (нужна Premium-подписка у владельца приложения).',
  })
  providers!: MusicProvider[];
}
