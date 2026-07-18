import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CursorDto } from '../../../common/pagination/cursor.dto';

export const INSIGHTS_PERIODS = ['7d', '30d', '90d'] as const;

export class ProfileInsightsQueryDto {
  @ApiPropertyOptional({ enum: INSIGHTS_PERIODS, default: '7d', description: 'Период аналитики' })
  @IsOptional()
  @IsIn(INSIGHTS_PERIODS)
  period?: string;
}

export class ProfileInsightsDto {
  @ApiProperty({ example: '7d' })
  period!: string;

  @ApiProperty({ example: 7, description: 'Дней в периоде' })
  days!: number;

  @ApiProperty({ example: 34, description: 'Новых подписчиков за период' })
  followersGained!: number;

  @ApiProperty({ example: 512, description: 'Просмотров профиля за период' })
  profileViews!: number;

  @ApiProperty({ example: 6, description: 'Опубликовано постов за период' })
  postsPublished!: number;

  @ApiProperty({ example: 1240, description: 'Уникальных аккаунтов, посмотревших мои посты' })
  accountsReached!: number;

  @ApiProperty({
    example: 320,
    description: 'Уникальных аккаунтов, взаимодействовавших (лайк/коммент/сохр/шер)',
  })
  accountsEngaged!: number;
}

const USERNAME_RE = /^[a-zA-Z0-9._]+$/;

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'oo1_gm',
    minLength: 3,
    maxLength: 30,
    description: 'Новый username. Если занят — 409; регистр не важен (Oo1 == oo1).',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(USERNAME_RE, { message: 'userName: только латиница, цифры, точка и подчёркивание' })
  userName?: string;

  @ApiPropertyOptional({ example: 'Фотограф из Душанбе', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'about: максимум 150 символов' })
  about?: string;

  @ApiPropertyOptional({ example: 'https://eraj.dev' })
  @IsOptional()
  @IsUrl({}, { message: 'website: некорректная ссылка' })
  website?: string;

  @ApiPropertyOptional({
    enum: Gender,
    example: Gender.MALE,
    description: 'Симметричный enum: что отправили — то и вернётся (баг softclub #12)',
  })
  @IsOptional()
  @IsEnum(Gender, { message: 'gender: MALE | FEMALE | OTHER | HIDDEN' })
  gender?: Gender;

  @ApiPropertyOptional({ example: 'Фотограф' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  occupation?: string;

  @ApiPropertyOptional({ example: '2000-05-17' })
  @IsOptional()
  @IsDateString({}, { message: 'dob: дата в формате YYYY-MM-DD' })
  dob?: string;

  @ApiPropertyOptional({ example: 1, description: 'id локации' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  locationId?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  showThreadsBadge?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isAiAuthor?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  showAccountSuggestions?: boolean;

  @ApiPropertyOptional({ example: 'Eraj Karimov', description: 'Имя и фамилия' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  fullName?: string;
}

export class UpdatePrivacyDto {
  @ApiProperty({ example: true, description: 'true — закрытый аккаунт' })
  @IsBoolean()
  isPrivate!: boolean;
}

export class ActivityQueryDto extends CursorDto {
  /**
   * ВНИМАНИЕ: здесь `cursor` — ISO-дата (`at` последнего элемента), а не id,
   * в отличие от остальных списков проекта. Причина — в ActivityItemDto.id.
   */

  @ApiPropertyOptional({ example: '2026-07-01', description: 'Фильтр: не раньше этой даты' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-31', description: 'Фильтр: не позже этой даты' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ─────────────── ответы ───────────────

export class ProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'eraj' })
  userName!: string;

  @ApiProperty({ example: 'Eraj Karimov' })
  fullName!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  avatarUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 150 })
  about?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  website?: string | null;

  @ApiProperty({ enum: Gender, example: Gender.HIDDEN })
  gender!: Gender;

  @ApiPropertyOptional({ type: String, nullable: true })
  occupation?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dob?: Date | null;

  @ApiProperty({ example: false })
  showThreadsBadge!: boolean;

  @ApiProperty({ example: false })
  isAiAuthor!: boolean;

  @ApiProperty({ example: true })
  showAccountSuggestions!: boolean;

  @ApiProperty({ example: false })
  isPrivate!: boolean;

  @ApiProperty({ example: false })
  isVerified!: boolean;

  @ApiProperty({ example: 42 })
  postsCount!: number;

  @ApiProperty({ example: 128 })
  followersCount!: number;

  @ApiProperty({ example: 97 })
  followingCount!: number;
}

/** Чужой профиль — те же поля + отношения между мной и им. */
export class OtherProfileDto extends ProfileDto {
  @ApiProperty({ example: false, description: 'Я подписан на него' })
  isFollowing!: boolean;

  @ApiProperty({ example: false, description: 'Он подписан на меня' })
  isFollowedBy!: boolean;

  @ApiProperty({ example: false, description: 'Я его заблокировал' })
  isBlocked!: boolean;

  @ApiProperty({ example: false, description: 'Моя заявка на подписку ждёт подтверждения' })
  hasRequestPending!: boolean;

  @ApiProperty({
    example: true,
    description: 'Виден ли контент: у закрытого аккаунта — только принятым подписчикам',
  })
  canViewContent!: boolean;
}

export class IsFollowingDto {
  @ApiProperty({ example: true })
  isFollowing!: boolean;

  @ApiProperty({ example: false })
  hasRequestPending!: boolean;
}

export class PostBriefDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  caption?: string | null;

  @ApiProperty({ example: false })
  isReel!: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Первое медиа — обложка в сетке',
  })
  coverUrl?: string | null;

  @ApiPropertyOptional({ example: 24, nullable: true })
  likesCount?: number | null;

  @ApiProperty({ example: 3 })
  commentsCount!: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  pinnedAt?: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class MusicBriefDto {
  @ApiProperty({ example: 7 })
  id!: number;

  @ApiProperty({ example: 'Blinding Lights' })
  title!: string;

  @ApiProperty({ example: 'The Weeknd' })
  artist!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  coverUrl?: string | null;

  @ApiProperty()
  savedAt!: Date;
}

export class ActivityItemDto {
  @ApiProperty({
    example: 'LIKE:12',
    description:
      'Составной id «ТИП:id строки». Список слит из четырёх таблиц, где id повторяются, ' +
      'поэтому простого id тут не существует. Для «показать ещё» используйте `at` (см. cursor).',
  })
  id!: string;

  @ApiProperty({
    enum: ['LIKE', 'COMMENT', 'POST_VIEW', 'SEARCH'],
    example: 'LIKE',
  })
  type!: 'LIKE' | 'COMMENT' | 'POST_VIEW' | 'SEARCH';

  @ApiProperty({ example: '2026-07-15T10:00:00.000Z' })
  at!: Date;

  @ApiPropertyOptional({ example: 12, description: 'id поста — для LIKE / COMMENT / POST_VIEW' })
  postId?: number;

  @ApiPropertyOptional({ description: 'Текст — для COMMENT и SEARCH' })
  text?: string;
}

export class AvatarDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'null после удаления' })
  avatarUrl?: string | null;
}

export class CollectionDto {
  @ApiProperty({
    example: 'Путешествия',
    description: 'Имя коллекции — оно же ключ при сохранении',
  })
  name!: string;

  @ApiProperty({ example: 7 })
  postsCount!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Превью последнего сохранённого поста (или явная обложка коллекции)',
  })
  coverUrl?: string | null;
}
