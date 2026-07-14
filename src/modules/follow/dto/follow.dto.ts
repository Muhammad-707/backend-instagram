import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FollowStatus } from '@prisma/client';
import { UserBriefDto } from '../../users/dto/users.dto';

export class FollowResultDto {
  @ApiProperty({
    enum: FollowStatus,
    example: FollowStatus.PENDING,
    description: 'Публичный аккаунт → ACCEPTED сразу. Приватный → PENDING (ждёт подтверждения)',
  })
  status!: FollowStatus;

  @ApiProperty({ example: true, description: 'Подписка активна (только при ACCEPTED)' })
  isFollowing!: boolean;

  @ApiProperty({ example: false })
  hasRequestPending!: boolean;

  @ApiProperty({ example: 'Заявка отправлена — аккаунт закрытый' })
  message!: string;
}

export class FollowRequestDto {
  @ApiProperty({ description: 'id заявки — им же accept / decline' })
  id!: string;

  @ApiProperty({ type: UserBriefDto, description: 'Кто просится в подписчики' })
  user!: UserBriefDto;

  @ApiProperty()
  createdAt!: Date;
}

export class FollowerDto extends UserBriefDto {
  @ApiPropertyOptional({
    example: true,
    description:
      'Подписан ли Я на этого человека — фронт рисует кнопку «Подписаться»/«Вы подписаны»',
  })
  isFollowedByMe?: boolean;
}

export class BlockedUserDto extends UserBriefDto {
  @ApiProperty({ description: 'Когда заблокирован' })
  blockedAt!: Date;
}

export class CloseFriendDto extends UserBriefDto {
  @ApiProperty()
  addedAt!: Date;
}

export class OkMessageDto {
  @ApiProperty({ example: 'Готово' })
  message!: string;
}
