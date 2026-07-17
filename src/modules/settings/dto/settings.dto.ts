import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommentPolicy, InteractionPolicy } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

const toBool = ({ value }: { value: unknown }): boolean =>
  value === true || value === 'true' || value === '1';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: true, description: 'Push-уведомления' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Уведомления по email' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional({ enum: InteractionPolicy, description: 'Кто может отмечать меня' })
  @IsOptional()
  @IsEnum(InteractionPolicy)
  whoCanTag?: InteractionPolicy;

  @ApiPropertyOptional({ enum: InteractionPolicy, description: 'Кто может @упоминать меня' })
  @IsOptional()
  @IsEnum(InteractionPolicy)
  whoCanMention?: InteractionPolicy;

  @ApiPropertyOptional({ enum: InteractionPolicy, description: 'Кто может писать мне (иначе — в запросы)' })
  @IsOptional()
  @IsEnum(InteractionPolicy)
  whoCanMessage?: InteractionPolicy;

  @ApiPropertyOptional({ enum: CommentPolicy, description: 'Кто может комментировать мои публикации' })
  @IsOptional()
  @IsEnum(CommentPolicy)
  whoCanComment?: CommentPolicy;

  @ApiPropertyOptional({ example: true, description: 'Разрешить GIF в комментариях' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  allowGifComments?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Разрешить репосты моих историй' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  allowStoryReshare?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Скрытые слова: комментарии с этими словами отклоняются',
    example: ['спам', 'реклама'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  hiddenWords?: string[];

  @ApiPropertyOptional({ example: 'ru', description: 'Язык интерфейса (код)' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;
}

export class SettingsDto {
  @ApiProperty({ example: true })
  pushEnabled!: boolean;

  @ApiProperty({ example: true })
  emailEnabled!: boolean;

  @ApiProperty({ enum: InteractionPolicy })
  whoCanTag!: InteractionPolicy;

  @ApiProperty({ enum: InteractionPolicy })
  whoCanMention!: InteractionPolicy;

  @ApiProperty({ enum: InteractionPolicy })
  whoCanMessage!: InteractionPolicy;

  @ApiProperty({ enum: CommentPolicy })
  whoCanComment!: CommentPolicy;

  @ApiProperty({ example: true })
  allowGifComments!: boolean;

  @ApiProperty({ example: true })
  allowStoryReshare!: boolean;

  @ApiProperty({ type: [String], example: ['спам'] })
  hiddenWords!: string[];

  @ApiProperty({ example: 'ru' })
  language!: string;
}

export class RestrictActionDto {
  @ApiProperty({ example: true })
  restricted!: boolean;
}
