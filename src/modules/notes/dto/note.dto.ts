import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MusicProvider, NoteAudience } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserBriefDto } from '../../users/dto/users.dto';

export const NOTE_TEXT_MAX = 60;

export class CreateNoteDto {
  @ApiProperty({ example: 'Слушаю музыку 🎧', maxLength: NOTE_TEXT_MAX })
  @IsString()
  @IsNotEmpty({ message: 'Заметка не может быть пустой' })
  @MaxLength(NOTE_TEXT_MAX, { message: `text: максимум ${NOTE_TEXT_MAX} символов` })
  text!: string;

  @ApiPropertyOptional({ example: 35, description: 'Трек из нашей библиотеки' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  musicId?: number;

  @ApiPropertyOptional({
    enum: MusicProvider,
    description: 'Каталог найденного трека (из /music/online). Идёт в паре с externalId.',
  })
  @IsOptional()
  @IsEnum(MusicProvider)
  provider?: MusicProvider;

  @ApiPropertyOptional({
    example: '908604612',
    description:
      'id трека в каталоге (из /music/online) — импортируем в Music и прикрепим ' +
      'вместе с обложкой и названием. Не добавляет трек в «сохранённые».',
  })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({ example: '#FFB6C1', description: 'Цвет фона заметки (hex)' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'bgColor: hex-цвет вида #RRGGBB' })
  bgColor?: string;

  @ApiPropertyOptional({ example: '#222222', description: 'Цвет текста заметки (hex)' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'textColor: hex-цвет вида #RRGGBB' })
  textColor?: string;

  @ApiPropertyOptional({
    enum: NoteAudience,
    default: NoteAudience.FOLLOWERS,
    description:
      'Кому видна заметка: FOLLOWERS — всем подписчикам, CLOSE_FRIENDS — только близким друзьям.',
  })
  @IsOptional()
  @IsEnum(NoteAudience)
  audience?: NoteAudience;
}

export class UpdateNoteDto {
  @ApiPropertyOptional({ example: 'Новый текст', maxLength: NOTE_TEXT_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_TEXT_MAX)
  text?: string;

  @ApiPropertyOptional({ example: 36 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  musicId?: number;

  @ApiPropertyOptional({ example: '#87CEEB' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'bgColor: hex-цвет вида #RRGGBB' })
  bgColor?: string;

  @ApiPropertyOptional({ example: '#222222' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'textColor: hex-цвет вида #RRGGBB' })
  textColor?: string;
}

export class NoteReplyDto {
  @ApiProperty({ example: 'Что за трек?', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text!: string;
}

// ─────────────── ответы ───────────────

export class NoteMusicDto {
  @ApiProperty({ example: 35 })
  id!: number;

  @ApiProperty({ example: 'Soundhelix song 1' })
  title!: string;

  @ApiProperty({ example: 'SoundHelix' })
  artist!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Наш стриминг с Range — только у локальных mp3. У треков из Spotify null: ' +
      'полного файла у нас нет, Spotify его не отдаёт.',
  })
  streamUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Что реально играет: наш mp3 либо 30-сек preview из Spotify.',
  })
  previewUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Обложка альбома' })
  coverUrl?: string | null;

  @ApiPropertyOptional({
    enum: MusicProvider,
    nullable: true,
    description: 'Каталог, откуда трек. null — наш локальный mp3',
  })
  provider?: MusicProvider | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'id трека в каталоге' })
  externalId?: string | null;

  @ApiProperty({ example: true, description: 'true — играется целиком; false — только превью' })
  isFullTrack!: boolean;
}

export class NoteDto {
  @ApiProperty({ example: 7 })
  id!: number;

  @ApiProperty({ example: 'Слушаю музыку 🎧' })
  text!: string;

  @ApiProperty({ type: UserBriefDto, description: 'Автор заметки' })
  author!: UserBriefDto;

  @ApiPropertyOptional({ type: NoteMusicDto, nullable: true })
  music?: NoteMusicDto | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '#FFB6C1' })
  bgColor?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '#222222' })
  textColor?: string | null;

  @ApiProperty({
    enum: NoteAudience,
    example: NoteAudience.FOLLOWERS,
    description: 'Кому видна: подписчикам или только близким друзьям',
  })
  audience!: NoteAudience;

  @ApiProperty({ example: 2 })
  likesCount!: number;

  @ApiProperty({ example: false, description: 'Лайкнул ли Я' })
  isLiked!: boolean;

  @ApiProperty({ example: false, description: 'Моя ли это заметка' })
  isMine!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  expiresAt!: Date;
}

export class NoteLikeToggleDto {
  @ApiProperty({ example: true })
  liked!: boolean;

  @ApiProperty({ example: 3 })
  likesCount!: number;
}

export class NoteLikeItemDto {
  @ApiProperty({ type: UserBriefDto })
  user!: UserBriefDto;

  @ApiProperty()
  likedAt!: Date;
}

export class NoteReplyItemDto {
  @ApiProperty({ example: 15 })
  id!: number;

  @ApiProperty({ example: 'Что за трек?' })
  text!: string;

  @ApiProperty({ type: UserBriefDto })
  author!: UserBriefDto;

  @ApiProperty()
  createdAt!: Date;
}

export class NoteReplySentDto {
  @ApiProperty({ example: true })
  sent!: boolean;

  @ApiProperty({ example: 5, description: 'id чата, куда ушёл ответ' })
  chatId!: number;

  @ApiProperty({ example: 128, description: 'id сообщения-ответа в чате' })
  messageId!: number;
}

export class DeletedDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}
