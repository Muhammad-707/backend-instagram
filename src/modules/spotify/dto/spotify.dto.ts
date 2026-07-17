import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class SearchSpotifyDto {
  @ApiProperty({ example: 'shape of you', description: 'Название трека / исполнитель' })
  @IsString()
  @IsNotEmpty({ message: 'q: укажите, что искать' })
  q!: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}

/** Трек из результатов поиска Spotify (ещё НЕ импортирован к нам). */
export class SpotifyTrackDto {
  @ApiProperty({ example: '7qiZfU4dY1lWllzX7mPBI3', description: 'id трека в Spotify' })
  spotifyId!: string;

  @ApiProperty({ example: 'Shape of You' })
  title!: string;

  @ApiProperty({ example: 'Ed Sheeran' })
  artist!: string;

  @ApiPropertyOptional({
    type: String,
    example: 'https://i.scdn.co/image/ab67616d...',
    nullable: true,
  })
  albumCover!: string | null;

  @ApiPropertyOptional({
    type: String,
    example: 'https://p.scdn.co/mp3-preview/...',
    nullable: true,
    description: '30-секундный отрывок (у части треков отсутствует → null)',
  })
  previewUrl!: string | null;

  @ApiProperty({ example: 'https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3' })
  spotifyUrl!: string;

  @ApiProperty({ example: 233, description: 'Длительность в секундах' })
  durationSec!: number;

  @ApiProperty({ example: false, description: 'Уже сохранён мной (импортирован в мою музыку)' })
  isSaved!: boolean;
}
