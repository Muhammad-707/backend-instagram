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

  @ApiPropertyOptional({ nullable: true, example: 12 })
  postId?: number | null;

  @ApiPropertyOptional({ nullable: true })
  commentId?: number | null;

  @ApiPropertyOptional({ nullable: true })
  storyId?: number | null;

  @ApiPropertyOptional({ nullable: true })
  noteId?: number | null;

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
