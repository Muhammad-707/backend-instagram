import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CallStatus, CallType, MsgType } from '@prisma/client';
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

/** Потолок участников группы, как в IG (включая создателя). */
export const GROUP_MAX_MEMBERS = 32;
/** Группа — это 3+ человека: я и минимум двое. Двое — это обычный 1-на-1. */
export const GROUP_MIN_INVITES = 2;
export const GROUP_TITLE_MAX = 50;

// ─────────────── входные ───────────────

export class CreateChatDto {
  @ApiProperty({ description: 'С кем начать переписку' })
  @IsUUID()
  receiverUserId!: string;
}

export class CreateGroupChatDto {
  @ApiPropertyOptional({
    example: 'Дӯстон',
    maxLength: GROUP_TITLE_MAX,
    description: 'Название группы. Если не задано — клиент показывает имена участников (как в IG).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(GROUP_TITLE_MAX)
  title?: string;

  @ApiProperty({
    type: [String],
    description: `Кого добавить (кроме себя). Минимум ${GROUP_MIN_INVITES} — иначе это обычный чат 1-на-1.`,
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6', '2b1c4d55-1111-4562-b3fc-2c963f66afa7'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class AddParticipantsDto {
  @ApiProperty({ type: [String], description: 'Кого добавить в группу' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class UpdateGroupTitleDto {
  @ApiProperty({ example: 'Наши', maxLength: GROUP_TITLE_MAX })
  @IsString()
  @IsNotEmpty()
  @MaxLength(GROUP_TITLE_MAX)
  title!: string;
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

  @ApiPropertyOptional({
    description: 'Отправить трек из нашей библиотеки (Music.id) — type станет MUSIC_SHARE',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  musicId?: number;

  @ApiPropertyOptional({
    description:
      'Отправить трек прямо из Spotify по его id — импортируем в Music и прикрепим. ' +
      'Не добавляет трек в «сохранённые»: поделиться и сохранить — разные действия.',
    example: '11dFghVXANMlKmJXsNCbNl',
  })
  @IsOptional()
  @IsString()
  spotifyId?: string;
}

/** Звонок внутри сообщения (type=CALL) — «Аудиозвонок, 5:32» / «Пропущенный». */
export class MessageCallDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CallType, example: CallType.AUDIO })
  type!: CallType;

  @ApiProperty({ enum: CallStatus, example: CallStatus.ENDED })
  status!: CallStatus;

  @ApiProperty({ example: 332, description: 'Секунды разговора; пропущенный/отклонённый → 0' })
  durationSec!: number;
}

/** Трек внутри сообщения — всё, что нужно, чтобы нарисовать плашку и включить звук. */
export class MessageMusicDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiProperty({ example: 'Blinding Lights' })
  title!: string;

  @ApiProperty({ example: 'The Weeknd' })
  artist!: string;

  @ApiProperty({ example: 'https://.../cover.jpg' })
  coverUrl!: string;

  @ApiProperty({ example: 200, description: 'Длительность трека, сек' })
  duration!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Наш стриминг с поддержкой Range — есть только у локальных mp3. ' +
      'У треков из Spotify null: полного файла у нас нет.',
  })
  streamUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Что реально играет: для локального трека — наш mp3, для Spotify — 30-сек preview ' +
      '(а если Spotify не дал preview — ссылка на Spotify, играть её нельзя).',
  })
  previewUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'id в Spotify, если оттуда' })
  spotifyId?: string | null;

  @ApiProperty({
    example: true,
    description: 'true — играется целиком (наш mp3); false — только превью Spotify',
  })
  isFullTrack!: boolean;
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

  @ApiPropertyOptional({ type: String, nullable: true })
  text?: string | null;

  @ApiProperty({ enum: MsgType })
  type!: MsgType;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Фото/видео/голос/стикер' })
  mediaUrl?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Секунды — для голосового/видео',
  })
  duration?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  replyToId?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'id отправленного поста' })
  sharedPostId?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Превью заметки (переживает её смерть)',
  })
  noteSnapshot?: string | null;

  @ApiPropertyOptional({
    type: MessageMusicDto,
    nullable: true,
    description: 'Трек, если type=MUSIC_SHARE',
  })
  music?: MessageMusicDto | null;

  @ApiPropertyOptional({
    type: MessageCallDto,
    nullable: true,
    description: 'Звонок, если type=CALL',
  })
  call?: MessageCallDto | null;

  @ApiProperty({ type: [MessageReactionDto] })
  reactions!: MessageReactionDto[];

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Когда отредактировано',
  })
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

  @ApiProperty({ example: false, description: 'true — групповой чат' })
  isGroup!: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Название группы (null у 1-на-1 и у групп без имени)',
  })
  title?: string | null;

  @ApiPropertyOptional({
    type: UserBriefDto,
    nullable: true,
    description: 'Собеседник. У группы — null: там нет «собеседника», есть participants.',
  })
  peer?: UserBriefDto | null;

  @ApiProperty({
    type: [UserBriefDto],
    description: 'Участники, кроме меня. У 1-на-1 — один человек (тот же, что peer).',
  })
  participants!: UserBriefDto[];

  @ApiProperty({ example: 4, description: 'Сколько всего участников, включая меня' })
  participantsCount!: number;

  @ApiProperty({ example: false, description: 'Я админ (создатель) этой группы' })
  isAdmin!: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Никнейм собеседника в этом чате',
  })
  peerNickname?: string | null;

  @ApiProperty({ example: 'default' })
  theme!: string;

  @ApiProperty({ example: false })
  isMuted!: boolean;

  @ApiPropertyOptional({ type: MessageDto, nullable: true, description: 'Последнее сообщение' })
  lastMessage?: MessageDto | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastMessageAt?: Date | null;

  @ApiProperty({ example: 3, description: 'Сколько непрочитанных' })
  unreadCount!: number;

  @ApiProperty({ example: true, description: 'Собеседник онлайн' })
  isOnline!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: '«был в сети N мин назад»',
  })
  lastSeenAt?: Date | null;
}

/**
 * Участник чата с присутствием: «в сети» / «был(а) в сети …».
 *
 * В 1-на-1 это показывалось через isOnline/lastSeenAt самого чата, но в группе
 * онлайн — свойство каждого человека, а не чата: одному общему флагу там
 * взяться неоткуда.
 */
export class ChatParticipantDto extends UserBriefDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Лакаб в этом чате' })
  nickname?: string | null;

  @ApiProperty({ example: false, description: 'Админ группы (создатель)' })
  isAdmin!: boolean;

  @ApiProperty({ example: true, description: 'Сейчас в сети' })
  isOnline!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: '«был(а) в сети …». null — если сейчас онлайн',
  })
  lastSeenAt?: Date | null;
}

export class ChatDetailDto {
  @ApiProperty({ example: 5 })
  id!: number;

  @ApiProperty({ example: false })
  isGroup!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Название группы' })
  title?: string | null;

  @ApiPropertyOptional({ type: UserBriefDto, nullable: true, description: 'null у группы' })
  peer?: UserBriefDto | null;

  @ApiProperty({
    type: [ChatParticipantDto],
    description: 'Участники, кроме меня — каждый со своим «в сети / был в сети»',
  })
  participants!: ChatParticipantDto[];

  @ApiProperty({ example: 4 })
  participantsCount!: number;

  @ApiProperty({ example: false, description: 'Я админ (создатель) группы' })
  isAdmin!: boolean;

  @ApiProperty({ example: 'default' })
  theme!: string;

  @ApiProperty({ example: false })
  isMuted!: boolean;

  @ApiProperty({ example: true, description: 'У группы всегда false — онлайн считается по peer' })
  isOnline!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastSeenAt?: Date | null;
}

export class GroupCreatedDto {
  @ApiProperty({ example: 7 })
  id!: number;

  @ApiProperty({ example: true })
  isGroup!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  title?: string | null;

  @ApiProperty({ example: 4, description: 'Участников всего, включая создателя' })
  participantsCount!: number;
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

/** Полное состояние звонка — то, что нужно, чтобы нарисовать и экран вызова, и строку в истории. */
export class CallStateDto {
  @ApiProperty()
  callId!: string;

  @ApiProperty({ example: 5 })
  chatId!: number;

  @ApiProperty({ description: 'Кто звонил' })
  callerId!: string;

  @ApiProperty({ enum: CallType, example: CallType.VIDEO })
  type!: CallType;

  @ApiProperty({
    enum: CallStatus,
    example: CallStatus.ENDED,
    description:
      'RINGING → ONGOING → ENDED. Не взяли трубку и завершили — MISSED (пропущенный), ' +
      'сбросили — DECLINED.',
  })
  status!: CallStatus;

  @ApiProperty({ type: String, format: 'date-time', description: 'Когда начали звонить' })
  startedAt!: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Когда взяли трубку. null — не ответили',
  })
  answeredAt?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  endedAt?: Date | null;

  @ApiProperty({
    example: 332,
    description: 'Длительность РАЗГОВОРА в секундах (от ответа до конца). Не дозвонились → 0',
  })
  durationSec!: number;
}

/** Один ICE-сервер в формате, который принимает браузерный RTCPeerConnection. */
export class IceServerDto {
  @ApiProperty({ type: [String], example: ['stun:stun.l.google.com:19302'] })
  urls!: string[];

  @ApiPropertyOptional({ description: 'Только для TURN' })
  username?: string;

  @ApiPropertyOptional({ description: 'Только для TURN' })
  credential?: string;
}

export class IceServersDto {
  @ApiProperty({
    type: [IceServerDto],
    description: 'Отдать как есть в `new RTCPeerConnection({ iceServers })`',
  })
  iceServers!: IceServerDto[];

  @ApiProperty({
    example: false,
    description:
      'false — TURN не настроен: звонок между двумя NAT (мобильный интернет) может не соединиться. ' +
      'Настраивается через TURN_URLS / TURN_USERNAME / TURN_PASSWORD в .env',
  })
  hasTurn!: boolean;
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
