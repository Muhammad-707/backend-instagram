import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { StoryDto } from './story.dto';

export class CreateHighlightDto {
  @ApiProperty({ example: 'Путешествия', maxLength: 60 })
  @IsString()
  @MaxLength(60)
  title!: string;

  @ApiProperty({ type: [Number], example: [12, 13, 14], description: 'id историй' })
  @IsArray()
  @ArrayNotEmpty({ message: 'Нужна хотя бы одна история' })
  @IsInt({ each: true })
  storyIds!: number[];

  @ApiPropertyOptional({ description: 'URL обложки; по умолчанию — первая история' })
  @IsOptional()
  @IsString()
  coverUrl?: string;
}

export class UpdateHighlightDto {
  @ApiPropertyOptional({ example: 'Лето 2026', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @ApiPropertyOptional({ type: [Number], description: 'Новый состав историй (заменяет прежний)' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  storyIds?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverUrl?: string;
}

export class HighlightDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Путешествия' })
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  coverUrl?: string | null;

  @ApiProperty({ example: 3, description: 'Сколько историй в актуальном' })
  count!: number;

  @ApiProperty()
  createdAt!: Date;
}

/** Актуальное с раскрытыми историями — для просмотра. */
export class HighlightWithStoriesDto extends HighlightDto {
  @ApiProperty({ type: [StoryDto] })
  stories!: StoryDto[];
}
