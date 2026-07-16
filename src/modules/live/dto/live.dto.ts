import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JoinStatus, LiveStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsEmoji } from '../../../common/validators/is-emoji.decorator';
import { UserBriefDto } from '../../users/dto/users.dto';

export class StartLiveDto {
  @ApiPropertyOptional({ example: 'Утренний стрим ☀️', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ description: 'Обложка (показывается, когда камера выключена)' })
  @IsOptional()
  @IsString()
  coverUrl?: string;
}

export class LiveCommentInputDto {
  @ApiProperty({ example: 'Огонь! 🔥', maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  text!: string;
}

export class LiveReactionInputDto {
  @ApiProperty({ example: '❤️', description: 'Любой эмодзи, включая составные (👨‍👩‍👧‍👦, 🏳️‍🌈, 👍🏽)' })
  @IsEmoji()
  emoji!: string;
}

export class CameraDto {
  @ApiProperty({
    example: false,
    description: 'false → видео выкл (аватар/обложка), ЗВУК идёт всегда',
  })
  @IsBoolean()
  on!: boolean;

  @ApiPropertyOptional({ description: 'Обложка на время выключенной камеры' })
  @IsOptional()
  @IsString()
  coverUrl?: string;
}

export class AudioDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  on!: boolean;
}

// ─────────────── ответы ───────────────

export class LiveDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: UserBriefDto }) host!: UserBriefDto;
  @ApiPropertyOptional({ type: String, nullable: true }) title!: string | null;
  @ApiProperty({ enum: LiveStatus }) status!: LiveStatus;
  @ApiProperty() isCameraOn!: boolean;
  @ApiProperty() isAudioOn!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) coverUrl!: string | null;
  @ApiProperty({ example: 12 }) viewersCount!: number;
  @ApiProperty({ example: 340 }) likesCount!: number;
  @ApiProperty({ type: String, format: 'date-time' }) startedAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  endedAt!: Date | null;
}

/** Ответ на start/join — эфир + LiveKit-токен + ws-URL. */
export class LiveTokenDto {
  @ApiProperty({ type: LiveDto }) live!: LiveDto;
  @ApiProperty({
    description: 'LiveKit access token (publisher для хоста/гостя, subscriber для зрителя)',
  })
  token!: string;
  @ApiProperty({ example: 'ws://localhost:7880' }) wsUrl!: string;
}

export class LiveViewerDto {
  @ApiProperty({ type: UserBriefDto }) user!: UserBriefDto;
  @ApiProperty({ type: String, format: 'date-time' }) joinedAt!: Date;
}

export class LiveCommentDto {
  @ApiProperty() id!: number;
  @ApiProperty({ type: UserBriefDto }) user!: UserBriefDto;
  @ApiProperty({ example: 'Огонь! 🔥' }) text!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class LiveLikeResultDto {
  @ApiProperty({ example: 341 }) likesCount!: number;
}

export class JoinRequestDto {
  @ApiProperty() id!: number;
  @ApiProperty({ type: UserBriefDto }) user!: UserBriefDto;
  @ApiProperty({ enum: JoinStatus }) status!: JoinStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class LiveStatsDto {
  @ApiProperty() viewersCount!: number;
  @ApiProperty() peakViewers!: number;
  @ApiProperty() totalViewers!: number;
  @ApiProperty() likesCount!: number;
  @ApiProperty() commentsCount!: number;
  @ApiProperty() reactionsCount!: number;
  @ApiProperty({ example: 632, description: 'Длительность эфира в секундах' })
  durationSec!: number;
}

export class LiveOkDto {
  @ApiProperty({ example: true }) ok!: boolean;
}

export class LiveRequestsQueryDto {
  @ApiPropertyOptional({
    enum: JoinStatus,
    description: 'Фильтр по статусу. Обычно PENDING — те, что ждут решения хоста.',
  })
  @IsOptional()
  @IsEnum(JoinStatus)
  status?: JoinStatus;
}
