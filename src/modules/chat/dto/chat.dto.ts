import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MsgType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
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
import { IsEmoji } from '../../../common/validators/is-emoji.decorator';
import { UserBriefDto } from '../../users/dto/users.dto';

export const MESSAGE_MAX = 2000;
/** Редактировать сообщение можно ≤15 минут (как в IG/Telegram). */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

// ─────────────── входные ───────────────

export class CreateChatDto {
  @ApiProperty({ description: 'С кем начать переписку' })
  @IsUUID()
  receiverUserId!: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'Привет!', maxLength: MESSAGE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(MESSAGE_MAX)
  text?: string;

  @ApiPropertyOptional({ example: 'STICKER', enum: MsgType })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Ответ на сообщение (id)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  replyToId?: number;

  @ApiPropertyOptional({ description: 'Отправить пост (id)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sharedPostId?: number;

  @ApiPropertyOptional({ description: 'URL стикера (если type=STICKER)' })
  @IsOptional()
  @IsString()
  stickerUrl?: string;
}

export class EditMessageDto {
  @ApiProperty({ example: 'Исправленный текст', maxLength: MESSAGE_MAX })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX)
  text!: string;
}

export class BulkDeleteDto {
  @ApiProperty({ type: [Number], example: [10, 11, 12] })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  messageIds!: number[];
}

export class ReactionDto {
  @ApiProperty({ example: '❤️', description: 'Любой эмодзи, включая составные (👨‍👩‍👧‍👦, 🏳️‍🌈, 👍🏽)' })
  @IsEmoji()
  emoji!: string;
}

export class ThemeDto {
  @ApiProperty({ example: 'sunset' })
  @IsString()
  @MaxLength(30)
  theme!: string;
}

export class NicknameDto {
  @ApiProperty({ description: 'Кому ставим никнейм' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'Братишка', maxLength: 40 })
  @IsString()
  @MaxLength(40)
  nickname!: string;
}

export class MuteDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  muted!: boolean;
}

export class ReportChatDto {
  @ApiProperty({ example: 'Спам' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class MessagesQueryDto extends CursorDto {}

// ─────────────── выходные ───────────────

export class MessageReactionDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ example: '❤️' })
  emoji!: string;
}

export class MessageDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ example: 5 })
  chatId!: number;

  @ApiProperty()
  senderId!: string;

  @ApiPropertyOptional({ nullable: true })
  text?: string | null;

  @ApiProperty({ enum: MsgType })
  type!: MsgType;

  @ApiPropertyOptional({ nullable: true, description: 'Фото/видео/голос/стикер' })
  mediaUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Секунды — для голосового/видео' })
  duration?: number | null;

  @ApiPropertyOptional({ nullable: true })
  replyToId?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'id отправленного поста' })
  sharedPostId?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Превью заметки (переживает её смерть)' })
  noteSnapshot?: string | null;

  @ApiProperty({ type: [MessageReactionDto] })
  reactions!: MessageReactionDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Когда отредактировано' })
  editedAt?: Date | null;

  @ApiProperty({ example: false })
  isDeleted!: boolean;

  @ApiProperty({ example: false, description: 'Прочитано собеседником' })
  isRead!: boolean;

  @ApiProperty()
  sentAt!: Date;
}

export class ChatListItemDto {
  @ApiProperty({ example: 5 })
  id!: number;

  @ApiProperty({ type: UserBriefDto, description: 'Собеседник (для 1-на-1)' })
  peer!: UserBriefDto;

  @ApiPropertyOptional({ nullable: true, description: 'Никнейм собеседника в этом чате' })
  peerNickname?: string | null;

  @ApiProperty({ example: 'default' })
  theme!: string;

  @ApiProperty({ example: false })
  isMuted!: boolean;

  @ApiPropertyOptional({ type: MessageDto, nullable: true, description: 'Последнее сообщение' })
  lastMessage?: MessageDto | null;

  @ApiPropertyOptional({ nullable: true })
  lastMessageAt?: Date | null;

  @ApiProperty({ example: 3, description: 'Сколько непрочитанных' })
  unreadCount!: number;

  @ApiProperty({ example: true, description: 'Собеседник онлайн' })
  isOnline!: boolean;

  @ApiPropertyOptional({ nullable: true, description: '«был в сети N мин назад»' })
  lastSeenAt?: Date | null;
}

export class ChatDetailDto {
  @ApiProperty({ example: 5 })
  id!: number;

  @ApiProperty({ type: UserBriefDto })
  peer!: UserBriefDto;

  @ApiProperty({ example: 'default' })
  theme!: string;

  @ApiProperty({ example: false })
  isMuted!: boolean;

  @ApiProperty({ example: true })
  isOnline!: boolean;

  @ApiPropertyOptional({ nullable: true })
  lastSeenAt?: Date | null;
}

export class ChatCreatedDto {
  @ApiProperty({ example: 5 })
  id!: number;

  @ApiProperty({ example: false, description: 'true — чат уже существовал (идемпотентность)' })
  existed!: boolean;

  @ApiProperty({
    example: false,
    description: 'true — ушло в «Запросы» (я не подписан на собеседника)',
  })
  isRequest!: boolean;
}

export class MessageRequestItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: UserBriefDto, description: 'Кто пишет' })
  fromUser!: UserBriefDto;

  @ApiProperty({ example: 5 })
  chatId!: number;

  @ApiPropertyOptional({
    type: MessageDto,
    nullable: true,
    description: 'Первое сообщение запроса',
  })
  lastMessage?: MessageDto | null;

  @ApiProperty()
  createdAt!: Date;
}

export class OkDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiPropertyOptional({ example: 'Готово' })
  message?: string;
}

export class DeletedCountDto {
  @ApiProperty({ example: 3 })
  deleted!: number;
}

export class CallStartedDto {
  @ApiProperty()
  callId!: string;

  @ApiProperty({ example: 5 })
  chatId!: number;

  @ApiProperty({ enum: ['AUDIO', 'VIDEO'], example: 'VIDEO' })
  type!: string;

  @ApiProperty({ example: 'RINGING' })
  status!: string;
}
