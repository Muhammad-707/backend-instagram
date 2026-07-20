import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType, MusicProvider, PostStatus, TagStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CursorDto } from '../../../common/pagination/cursor.dto';
import { AttachedMusicDto } from '../../music/attached-music.service';
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

  @ApiPropertyOptional({
    enum: MusicProvider,
    description: 'Каталог трека, найденного через GET /music/online. В паре с externalId.',
  })
  @IsOptional()
  @IsEnum(MusicProvider)
  provider?: MusicProvider;

  @ApiPropertyOptional({
    example: '908604612',
    description: 'id трека в каталоге — импортируем и прикрепим к посту.',
  })
  @IsOptional()
  @IsString()
  externalId?: string;

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

  @ApiPropertyOptional({
    example: 42,
    description:
      'id оригинального reel, если это ремикс («Remix of @author»). Только для isReel=true.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  remixOfId?: number;

  @ApiPropertyOptional({
    enum: [PostStatus.DRAFT, PostStatus.SCHEDULED],
    description:
      'DRAFT → черновик, SCHEDULED → отложенная публикация (нужен scheduledAt). Без него — сразу публикуется.',
  })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiPropertyOptional({
    example: '2026-07-18T18:00:00.000Z',
    description: 'ISO-время публикации для status=SCHEDULED (в будущем)',
  })
  @IsOptional()
  @IsString()
  scheduledAt?: string;
}

export class DraftsQueryDto extends CursorDto {
  @ApiPropertyOptional({
    enum: [PostStatus.DRAFT, PostStatus.SCHEDULED],
    description: 'Фильтр: только DRAFT или только SCHEDULED. Без него — оба.',
  })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}

export class UpdatePostDto {
  @ApiProperty({ example: 'Новая подпись #sunset', maxLength: CAPTION_MAX })
  @IsString()
  @MaxLength(CAPTION_MAX)
  caption!: string;
}

export class InviteCollaboratorsDto {
  @ApiProperty({ type: [String], description: 'id соавторов (приглашение, статус PENDING)' })
  @Transform(toStringArray)
  @IsArray()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class CollaboratorActionDto {
  @ApiProperty({ enum: ['ACCEPTED', 'DECLINED'], example: 'ACCEPTED' })
  status!: string;
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

export class UpdatePostPrivacyDto {
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  hideLikeCount?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  commentsDisabled?: boolean;
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

  @ApiPropertyOptional({ type: Number, nullable: true })
  width?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  height?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Секунды — для видео' })
  duration?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Постер видео' })
  thumbUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
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

/** Краткая ссылка на оригинальный reel, с которого снят ремикс. */
export class RemixRefDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ type: UserBriefDto, description: 'Автор оригинального reel' })
  author!: UserBriefDto;
}

export class PostDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: CAPTION_MAX })
  caption?: string | null;

  @ApiProperty({ example: false })
  isReel!: boolean;

  @ApiProperty({ example: false })
  isArchived!: boolean;

  @ApiPropertyOptional({
    type: RemixRefDto,
    nullable: true,
    description: 'Оригинальный reel, если это ремикс. Фронт рисует «Remix of @author».',
  })
  remixOf?: RemixRefDto | null;

  @ApiPropertyOptional({ enum: PostStatus, description: 'DRAFT/SCHEDULED/PUBLISHED' })
  status?: PostStatus;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Когда опубликуется (SCHEDULED)',
  })
  scheduledAt?: Date | null;

  @ApiProperty({ type: UserBriefDto, description: 'Автор — НИКОГДА не null' })
  author!: UserBriefDto;

  @ApiProperty({ type: [PostMediaDto] })
  media!: PostMediaDto[];

  @ApiPropertyOptional({ type: PostLocationDto, nullable: true })
  location?: PostLocationDto | null;

  @ApiPropertyOptional({ type: AttachedMusicDto, nullable: true })
  music?: AttachedMusicDto | null;

  @ApiProperty({ type: [UserBriefDto], description: 'Отмеченные на фото' })
  taggedUsers!: UserBriefDto[];

  @ApiProperty({
    type: [UserBriefDto],
    description: 'Соавторы (принявшие приглашение) — пост в профиле у каждого',
  })
  collaborators!: UserBriefDto[];

  @ApiProperty({ type: [String], example: ['travel', 'sunset'] })
  hashtags!: string[];

  @ApiPropertyOptional({ example: 24, nullable: true })
  likesCount?: number | null;

  @ApiProperty({ example: 3 })
  commentsCount!: number;

  @ApiProperty({ example: 120 })
  viewsCount!: number;

  @ApiProperty({ example: 7 })
  repostsCount!: number;

  @ApiProperty({ example: false, description: 'Лайкнул ли Я' })
  isLiked!: boolean;

  @ApiProperty({ example: false, description: 'В избранном ли у меня' })
  isFavorited!: boolean;

  @ApiProperty({ example: false, description: 'Репостнул ли Я (кнопка «двойная стрелка»)' })
  isReposted!: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Смотрел ли Я этот пост (для ранжированной ленты — просмотренные уходят вниз)',
  })
  isSeen?: boolean;

  @ApiPropertyOptional({ example: null, nullable: true })
  pinnedAt?: Date | null;

  @ApiProperty({ example: false })
  hideLikeCount!: boolean;

  @ApiProperty({ example: false })
  commentsDisabled!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

/**
 * Ответ ленты подписок. Помимо курсорной страницы:
 *  - `allCaughtUp` — все посты подписок за последние сутки уже просмотрены («You're all caught up»);
 *  - `suggested` — рекомендованные посты не-подписок (показываются в конце ленты, как в IG).
 */
export class FeedDto {
  @ApiProperty({ type: [PostDto] })
  items!: PostDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Курсор следующей страницы' })
  nextCursor!: string | null;

  @ApiProperty({ example: true })
  hasMore!: boolean;

  @ApiProperty({ example: false, description: '«Вы всё посмотрели» — непросмотренного нет' })
  allCaughtUp!: boolean;

  @ApiProperty({
    type: [PostDto],
    description: 'Рекомендованные посты (не-подписки), в конце ленты',
  })
  suggested!: PostDto[];
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

export class RepostToggleDto {
  @ApiProperty({ example: true, description: 'true — репостнул, false — репост снят' })
  reposted!: boolean;

  @ApiProperty({ example: 7 })
  repostsCount!: number;
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

export class TagActionDto {
  @ApiProperty({
    enum: TagStatus,
    example: TagStatus.ACCEPTED,
    description: 'Итог: ACCEPTED → пост в «Фото с вами», DECLINED → скрыт',
  })
  status!: TagStatus;
}

// ─────────────── insights (Фаза 8) ───────────────

/** Откуда пришёл просмотр — источник трафика для аналитики. */
export const VIEW_SOURCES = ['feed', 'explore', 'profile', 'hashtag', 'reels', 'direct'] as const;

export class ViewQueryDto {
  @ApiPropertyOptional({
    enum: VIEW_SOURCES,
    description: 'Источник просмотра (для insights автора). По умолчанию не пишется.',
  })
  @IsOptional()
  @IsIn(VIEW_SOURCES)
  source?: string;
}

export class SourceBreakdownDto {
  @ApiProperty({ example: 'explore' })
  source!: string;

  @ApiProperty({ example: 128 })
  count!: number;
}

export class PostInsightsDto {
  @ApiProperty({ example: 340, description: 'Охват — сколько уникальных аккаунтов посмотрело' })
  reach!: number;

  @ApiProperty({ example: 52 })
  likes!: number;

  @ApiProperty({ example: 8 })
  comments!: number;

  @ApiProperty({ example: 12, description: 'Сохранения' })
  saves!: number;

  @ApiProperty({ example: 5 })
  shares!: number;

  @ApiProperty({ example: 0.226, description: '(likes+comments+saves+shares)/reach' })
  engagementRate!: number;

  @ApiProperty({ example: 210, description: 'Просмотры от подписчиков автора' })
  fromFollowers!: number;

  @ApiProperty({ example: 130, description: 'Просмотры не от подписчиков' })
  fromNonFollowers!: number;

  @ApiProperty({ type: [SourceBreakdownDto], description: 'Топ-источники трафика' })
  sources!: SourceBreakdownDto[];
}
