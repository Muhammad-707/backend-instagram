import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { UserBriefDto } from '../../users/dto/users.dto';

export const NOTE_TEXT_MAX = 60;

export class CreateNoteDto {
  @ApiProperty({ example: 'Слушаю музыку 🎧', maxLength: NOTE_TEXT_MAX })
  @IsString()
  @IsNotEmpty({ message: 'Заметка не может быть пустой' })
  @MaxLength(NOTE_TEXT_MAX, { message: `text: максимум ${NOTE_TEXT_MAX} символов` })
  text!: string;

  @ApiPropertyOptional({ example: 35 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  musicId?: number;

  @ApiPropertyOptional({ example: '#FFB6C1', description: 'Цвет фона заметки (hex)' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'bgColor: hex-цвет вида #RRGGBB' })
  bgColor?: string;
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

  @ApiProperty()
  streamUrl!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  coverUrl?: string | null;
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
