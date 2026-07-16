import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsEmoji } from '../../../common/validators/is-emoji.decorator';
import { UserBriefDto } from '../../users/dto/users.dto';

export const MAX_STORY_FILES = 10;

const toBool = ({ value }: { value: unknown }): boolean =>
  value === true || value === 'true' || value === '1';

export class CreateStoryDto {
  @ApiPropertyOptional({ example: 35 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  musicId?: number;

  @ApiPropertyOptional({ example: 12.5, description: 'С какой секунды играть музыку' })
  @IsOptional()
  @Type(() => Number)
  musicStartSec?: number;

  @ApiPropertyOptional({
    description: 'JSON-массив overlays: текст, стикеры, эффекты (позиции, цвета)',
    example: '[{"type":"text","value":"Привет!","x":0.5,"y":0.3}]',
  })
  @IsOptional()
  @IsString()
  overlays?: string;

  @ApiPropertyOptional({ example: 'clarendon' })
  @IsOptional()
  @IsString()
  filter?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Только для близких друзей (зелёное кольцо)',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  closeFriendsOnly?: boolean;

  @ApiPropertyOptional({ example: 12, description: 'Поделиться постом/reels в историю' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fromPostId?: number;
}

export class ReactionDto {
  @ApiProperty({
    example: '❤️',
    description: 'Любой эмодзи-реакция, включая составные (👨‍👩‍👧‍👦, 🏳️‍🌈, 👍🏽)',
  })
  @IsEmoji()
  emoji!: string;
}

export class StoryReplyDto {
  @ApiProperty({ example: 'Классная история!', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text!: string;
}

// ─────────────── ответы ───────────────

export class StoryMusicDto {
  @ApiProperty({ example: 35 })
  id!: number;

  @ApiProperty({ example: 'Soundhelix song 1' })
  title!: string;

  @ApiProperty({ example: 'SoundHelix' })
  artist!: string;

  @ApiProperty()
  streamUrl!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  coverUrl?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  startSec?: number | null;
}

export class StoryDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiProperty({ example: 'http://localhost:9000/instagram/images/2026/07/a.webp' })
  mediaUrl!: string;

  @ApiProperty({ enum: MediaType, example: MediaType.IMAGE })
  mediaType!: MediaType;

  @ApiPropertyOptional({ type: String, nullable: true })
  thumbUrl?: string | null;

  @ApiProperty({ example: 5, description: 'Секунд показа' })
  duration!: number;

  @ApiPropertyOptional({ type: StoryMusicDto, nullable: true })
  music?: StoryMusicDto | null;

  // Асимметрия чтения и записи, поэтому описана явно: в CreateStoryDto
  // overlays — СТРОКА с JSON (multipart иначе не умеет), а здесь, на чтение,
  // в БД лежит Json и наружу уходит уже РАЗОБРАННЫЙ массив объектов.
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    nullable: true,
    description:
      'Разобранный JSON: текст/стикеры/эффекты. ВНИМАНИЕ: на запись (POST /stories) ' +
      'это поле принимает СТРОКУ с JSON, а на чтение возвращается массивом.',
    example: [{ type: 'text', value: 'Привет!', x: 0.5, y: 0.3 }],
  })
  overlays?: unknown;

  @ApiPropertyOptional({ type: String, nullable: true })
  filter?: string | null;

  @ApiProperty({ example: false })
  closeFriendsOnly!: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'id поста, если история — репост' })
  fromPostId?: number | null;

  @ApiProperty({ example: false, description: 'Смотрел ли Я — считается на СЕРВЕРЕ' })
  isViewed!: boolean;

  @ApiProperty({ example: false, description: 'Лайкнул ли Я' })
  isLiked!: boolean;

  @ApiProperty({ example: 3 })
  likesCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  expiresAt!: Date;
}

/** Рейл историй: сгруппировано по авторам. */
export class StoryRailItemDto {
  @ApiProperty({ type: UserBriefDto })
  author!: UserBriefDto;

  @ApiProperty({ example: 3, description: 'Сколько историй у автора' })
  count!: number;

  @ApiProperty({ example: false, description: 'Все истории просмотрены — серое кольцо' })
  allViewed!: boolean;

  @ApiProperty({ example: false, description: 'Есть истории только для близких — зелёное кольцо' })
  hasCloseFriends!: boolean;

  @ApiProperty({ example: '2026-07-15T10:00:00.000Z', description: 'Время самой свежей истории' })
  latestAt!: Date;
}

export class StoryLikeToggleDto {
  @ApiProperty({ example: true, description: 'boolean, НЕ строка "Liked" (баг softclub #15)' })
  liked!: boolean;

  @ApiProperty({ example: 4 })
  likesCount!: number;
}

export class StoryViewerDto {
  @ApiProperty({ description: 'id записи просмотра (StoryView) — ключ строки в списке' })
  id!: string;

  @ApiProperty({ type: UserBriefDto })
  user!: UserBriefDto;

  @ApiProperty({ example: true })
  viewed!: boolean;

  @ApiProperty({ example: false, description: 'Этот зритель лайкнул' })
  liked!: boolean;

  @ApiPropertyOptional({ type: String, example: '❤️', nullable: true, description: 'Реакция зрителя, если была' })
  reaction?: string | null;

  @ApiProperty()
  viewedAt!: Date;
}

export class ReactionSentDto {
  @ApiProperty({ example: true })
  sent!: boolean;

  @ApiProperty({ example: 5, description: 'id чата, куда ушла реакция' })
  chatId!: number;

  @ApiProperty({ example: 128, description: 'id сообщения-реакции в чате' })
  messageId!: number;
}

export class DeletedDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}
