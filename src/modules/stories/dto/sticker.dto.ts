import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoryStickerType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UserBriefDto } from '../../users/dto/users.dto';

export class CreateStickerDto {
  @ApiProperty({ enum: StoryStickerType })
  @IsEnum(StoryStickerType)
  type!: StoryStickerType;

  @ApiProperty({
    description:
      'Параметры по типу. POLL {question, options[]}; QUIZ {question, options[], correctIndex}; ' +
      'QUESTION {prompt}; SLIDER {question, emoji}; COUNTDOWN {title, endsAt}; LINK {url, label}.',
    example: { question: 'Заходишь?', options: ['Да', 'Нет'] },
  })
  @IsObject()
  config!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Положение {x,y,scale,rotate}' })
  @IsOptional()
  @IsObject()
  geometry?: Record<string, unknown>;
}

export class AnswerStickerDto {
  @ApiPropertyOptional({ description: 'POLL/QUIZ — индекс варианта', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  optionIndex?: number;

  @ApiPropertyOptional({ description: 'QUESTION — свободный текст', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;

  @ApiPropertyOptional({ description: 'SLIDER — значение 0..1', example: 0.75 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  sliderValue?: number;
}

export class StickerDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: StoryStickerType }) type!: StoryStickerType;
  @ApiProperty() config!: Record<string, unknown>;
  @ApiPropertyOptional({ nullable: true }) geometry?: Record<string, unknown> | null;
  @ApiPropertyOptional({ description: 'Мой ответ (если отвечал)', nullable: true })
  myAnswer?: {
    optionIndex?: number | null;
    text?: string | null;
    sliderValue?: number | null;
  } | null;
}

export class AnswerResultDto {
  @ApiProperty({ example: true }) ok!: boolean;
  @ApiPropertyOptional({ description: 'QUIZ — правильный вариант (раскрывается после ответа)' })
  correctIndex?: number;
}

/** Итоги стикера — только автору истории. Форма зависит от типа. */
export class StickerResultsDto {
  @ApiProperty({ enum: StoryStickerType }) type!: StoryStickerType;
  @ApiProperty({ example: 12, description: 'Всего ответов' }) total!: number;

  @ApiPropertyOptional({
    type: [Object],
    description: 'POLL/QUIZ — по вариантам: {index, count, percent}',
  })
  options?: { index: number; count: number; percent: number }[];

  @ApiPropertyOptional({ description: 'QUIZ — доля правильных, %' })
  correctPercent?: number;

  @ApiPropertyOptional({ description: 'SLIDER — среднее значение 0..1' })
  average?: number;

  @ApiPropertyOptional({ type: [Object], description: 'QUESTION — ответы: {user, text}' })
  responses?: { user: UserBriefDto; text: string }[];
}
