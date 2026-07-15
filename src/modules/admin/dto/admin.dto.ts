import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportTargetType, Role } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CursorDto } from '../../../common/pagination/cursor.dto';
import { UserBriefDto } from '../../users/dto/users.dto';

export class AdminUsersQueryDto extends CursorDto {
  @ApiPropertyOptional({ description: 'Подстрока по userName/fullName/email' })
  @IsOptional()
  @IsString()
  q?: string;
}

export class AdminReportsQueryDto extends CursorDto {
  @ApiPropertyOptional({ enum: ['open', 'resolved'], description: 'open — только нерешённые' })
  @IsOptional()
  @IsIn(['open', 'resolved'])
  filter?: 'open' | 'resolved';
}

export class AdminUserDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'eraj' }) userName!: string;
  @ApiProperty({ example: 'Eraj Rahimov' }) fullName!: string;
  @ApiProperty({ example: 'eraj@example.com' }) email!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty() isVerified!: boolean;
  @ApiProperty() isPrivate!: boolean;
  @ApiProperty() isDeleted!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class AdminReportDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: UserBriefDto }) reporter!: UserBriefDto;
  @ApiProperty({ enum: ReportTargetType }) targetType!: ReportTargetType;
  @ApiProperty({ example: '42' }) targetId!: string;
  @ApiProperty({ example: 'спам' }) reason!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  resolvedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class AdminOkDto {
  @ApiProperty({ example: true }) ok!: boolean;
}
