import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CursorDto } from '../../../common/pagination/cursor.dto';
import { UserBriefDto } from '../../users/dto/users.dto';

export const CAPTION_MAX = 2200;
export const MAX_MEDIA = 10;

/** multipart шлёт всё строками: "true"/"1" → boolean, "5" → number, "a,b" → string[]. */
const toBool = ({ value }: { value: unknown }): boolean =>
  value === true || value === 'true' || value === '1';

const toStringArray = ({ value }: { value: unknown }): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.length > 0) return value.split(',').map((s) => s.trim());
  return [];
};

export class CreatePostDto {
  @ApiPropertyOptional({ example: 'Закат в горах 🏔 #travel @eraj', maxLength: CAPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(CAPTION_MAX, { message: `caption: максимум ${CAPTION_MAX} символов` })
  caption?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  locationId?: number;

  @ApiPropertyOptional({ example: 35 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  musicId?: number;

  @ApiPropertyOptional({ type: [String], description: 'id отмеченных пользователей' })
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsUUID('4', { each: true })
  taggedUserIds?: string[];

  @ApiPropertyOptional({ type: [String], example: ['clarendon'], description: 'Имена фильтров' })
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  filters?: string[];

  @ApiPropertyOptional({ example: false, description: 'true → Reels' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isReel?: boolean;
}

export class UpdatePostDto {
  @ApiProperty({ example: 'Новая подпись #sunset', maxLength: CAPTION_MAX })
  @IsString()
  @MaxLength(CAPTION_MAX)
  caption!: string;
}

export class ShareDto {
  @ApiPropertyOptional({ description: 'Кому отправить в чат (id пользователя)' })
  @IsOptional()
  @IsUUID()
  toUserId?: string;

  @ApiPropertyOptional({ example: false, description: 'true → поделиться в свою историю' })
  @IsOptional()
  @IsBoolean()
  toStory?: boolean;
}

export class ReportPostDto {
  @ApiProperty({ example: 'Спам' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class MyPostsQueryDto extends CursorDto {
  @ApiPropertyOptional({ example: false, description: 'true → архивные' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  archived?: boolean;
}

export class ExploreQueryDto extends CursorDto {
  @ApiPropertyOptional({ example: 'travel', description: 'Фильтр по хэштегу (без #)' })
  @IsOptional()
  @IsString()
  hashtag?: string;

  @ApiPropertyOptional({ example: 12, description: 'Фильтр по локации (id)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  locationId?: number;
}

// ─────────────── ответы ───────────────

export class PostMediaDto {
  @ApiProperty({ example: 'http://localhost:9000/instagram/images/2026/07/a.webp' })
  url!: string;

  @ApiProperty({ enum: MediaType, example: MediaType.IMAGE })
  type!: MediaType;

  @ApiProperty({ example: 0 })
  order!: number;

  @ApiPropertyOptional({ nullable: true })
  width?: number | null;

  @ApiPropertyOptional({ nullable: true })
  height?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Секунды — для видео' })
  duration?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Постер видео' })
  thumbUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  filter?: string | null;
}

export class PostLocationDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Dushanbe' })
  city!: string;

  @ApiProperty({ example: 'Tajikistan' })
  country!: string;
}

export class PostMusicDto {
  @ApiProperty({ example: 35 })
  id!: number;

  @ApiProperty({ example: 'Soundhelix song 1' })
  title!: string;

  @ApiProperty({ example: 'SoundHelix' })
  artist!: string;

  @ApiProperty({ example: 'http://localhost:3000/api/music/35/stream' })
  streamUrl!: string;

  @ApiProperty({ example: 'http://localhost:9000/instagram/music/covers/x.webp' })
  coverUrl!: string;
}

export class PostDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiPropertyOptional({ nullable: true, maxLength: CAPTION_MAX })
  caption?: string | null;

  @ApiProperty({ example: false })
  isReel!: boolean;

  @ApiProperty({ example: false })
  isArchived!: boolean;

  @ApiProperty({ type: UserBriefDto, description: 'Автор — НИКОГДА не null' })
  author!: UserBriefDto;

  @ApiProperty({ type: [PostMediaDto] })
  media!: PostMediaDto[];

  @ApiPropertyOptional({ type: PostLocationDto, nullable: true })
  location?: PostLocationDto | null;

  @ApiPropertyOptional({ type: PostMusicDto, nullable: true })
  music?: PostMusicDto | null;

  @ApiProperty({ type: [UserBriefDto], description: 'Отмеченные на фото' })
  taggedUsers!: UserBriefDto[];

  @ApiProperty({ type: [String], example: ['travel', 'sunset'] })
  hashtags!: string[];

  @ApiProperty({ example: 24 })
  likesCount!: number;

  @ApiProperty({ example: 3 })
  commentsCount!: number;

  @ApiProperty({ example: 120 })
  viewsCount!: number;

  @ApiProperty({ example: false, description: 'Лайкнул ли Я' })
  isLiked!: boolean;

  @ApiProperty({ example: false, description: 'В избранном ли у меня' })
  isFavorited!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

export class LikeToggleDto {
  @ApiProperty({ example: true })
  liked!: boolean;

  @ApiProperty({ example: 25 })
  likesCount!: number;
}

export class FavoriteToggleDto {
  @ApiProperty({ example: true })
  favorited!: boolean;
}

export class ViewDto {
  @ApiProperty({ example: 121 })
  viewsCount!: number;

  @ApiProperty({ example: true, description: 'false — этот юзер уже смотрел раньше' })
  counted!: boolean;
}

export class ShareResultDto {
  @ApiProperty({ example: 'http://localhost:3000/p/12', description: '«Копировать ссылку»' })
  link!: string;

  @ApiPropertyOptional({ example: 5, description: 'id чата, если отправляли в чат' })
  chatId?: number;

  @ApiProperty({ example: 'Ссылка на публикацию' })
  message!: string;
}

export class ArchiveDto {
  @ApiProperty({ example: true })
  isArchived!: boolean;
}
