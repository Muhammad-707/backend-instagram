import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotifType } from '@prisma/client';
import { UserBriefDto } from '../../users/dto/users.dto';

export class NotificationDto {
  @ApiProperty({ description: 'id последнего уведомления в группе' })
  id!: number;

  @ApiProperty({ enum: NotifType, example: NotifType.LIKE_POST })
  type!: NotifType;

  @ApiProperty({ type: UserBriefDto, description: 'Последний из тех, кто совершил действие' })
  actor!: UserBriefDto;

  @ApiProperty({
    example: 2,
    description: 'Сколько ЕЩЁ людей в группе (кроме actor). 0 — уведомление одиночное',
  })
  othersCount!: number;

  @ApiProperty({
    example: 'eraj и ещё 5 оценили вашу публикацию',
    description: 'Готовый текст с учётом группировки',
  })
  message!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 12 })
  postId?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  commentId?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  storyId?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  noteId?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'id эфира для LIVE_* — без него по уведомлению некуда перейти',
  })
  liveId?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 42,
    description:
      'id заявки в эфир (LIVE_JOIN_REQUEST). Именно его принимает ' +
      'POST /live/requests/{id}/accept | /decline',
  })
  requestId?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Миниатюра поста (первое медиа) — картинка справа в строке уведомления',
  })
  postThumbUrl?: string | null;

  @ApiProperty({ example: false })
  isRead!: boolean;

  @ApiProperty({
    type: [Number],
    description: 'id всех уведомлений группы — для пометки прочитанными',
  })
  groupIds!: number[];

  @ApiProperty()
  createdAt!: Date;
}

export class UnreadCountDto {
  @ApiProperty({ example: 7 })
  count!: number;
}

export class ProfileViewDto {
  @ApiProperty({ description: 'id строки — курсор для следующей страницы' })
  id!: string;

  @ApiProperty({ type: UserBriefDto })
  viewer!: UserBriefDto;

  @ApiProperty()
  viewedAt!: Date;
}

export class OkDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiPropertyOptional({ example: 3, description: 'Сколько помечено прочитанными' })
  updated?: number;
}
