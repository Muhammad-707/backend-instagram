import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ReportTargetType } from '@prisma/client';
import { CursorDto } from '../../../common/pagination/cursor.dto';

export class SearchUsersDto extends CursorDto {
  @ApiPropertyOptional({
    example: 'er',
    description: 'Подстрока — ищет и в userName, и в fullName («er» найдёт eraj и amERica)',
  })
  @IsOptional()
  @IsString()
  q?: string;
}

export class AddSearchTextDto {
  @ApiProperty({ example: 'закат', description: 'Текст поискового запроса' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  text!: string;
}

export class AddSearchedUserDto {
  @ApiProperty({ description: 'id юзера, чей профиль открыли из поиска' })
  @IsString()
  @IsNotEmpty()
  searchedUserId!: string;
}

export class ReportUserDto {
  @ApiProperty({ example: 'Спам и оскорбления' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// ─────────────── ответы ───────────────

export class UserBriefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'eraj' })
  userName!: string;

  @ApiProperty({ example: 'Eraj Karimov' })
  fullName!: string;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl?: string | null;

  @ApiProperty({ example: false })
  isVerified!: boolean;

  @ApiProperty({ example: false })
  isPrivate!: boolean;
}

export class SearchHistoryItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'закат' })
  text!: string;

  @ApiProperty({
    example: '2026-07-15T10:00:00.000Z',
    description: 'Баг softclub #19: createdAt раньше не отдавался — фронт не мог сортировать',
  })
  createdAt!: Date;
}

export class SearchedUserItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: UserBriefDto })
  user!: UserBriefDto;

  @ApiProperty({ example: '2026-07-15T10:00:00.000Z' })
  createdAt!: Date;
}

export class SuggestionDto extends UserBriefDto {
  @ApiProperty({
    type: [String],
    example: ['m.ibrohim', 'sadi'],
    description: 'Общие подписки — фронт рисует «Подписаны: m.ibrohim»',
  })
  followedBy!: string[];

  @ApiProperty({ example: 2, description: 'Сколько всего общих подписок' })
  followedByCount!: number;
}

export class ReportCreatedDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.USER })
  @IsEnum(ReportTargetType)
  targetType!: ReportTargetType;

  @ApiProperty()
  targetId!: string;

  @ApiProperty({ example: 'Жалоба отправлена, мы её рассмотрим' })
  message!: string;
}

export class DeletedCountDto {
  @ApiProperty({ example: 5, description: 'Сколько записей удалено' })
  deleted!: number;
}

export class AccountDeletedDto {
  @ApiProperty({
    example: '2026-08-14T10:00:00.000Z',
    description: 'До этой даты можно восстановить',
  })
  restorableUntil!: Date;

  @ApiProperty({ example: 'Аккаунт удалён. Восстановить можно в течение 30 дней' })
  message!: string;
}
