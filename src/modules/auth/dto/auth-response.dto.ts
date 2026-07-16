import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty({ example: '6f1c9e1a-2b3d-4c5e-8a7b-9d0e1f2a3b4c' })
  id!: string;

  @ApiProperty({ example: 'eraj_dev' })
  userName!: string;

  @ApiProperty({ example: 'Eraj Karimov' })
  fullName!: string;

  @ApiProperty({ example: 'eraj@example.com' })
  email!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '+992901234567' })
  phone?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2000-05-17T00:00:00.000Z',
  })
  dob?: Date | null;

  @ApiProperty({ example: 'USER', enum: ['USER', 'ADMIN'] })
  role!: string;

  @ApiProperty({ example: false })
  isPrivate!: boolean;

  @ApiProperty({ example: false })
  isVerified!: boolean;

  @ApiPropertyOptional({ type: String, description: 'Аватар из Profile', nullable: true })
  avatarUrl?: string | null;
}

export class TokensDto {
  @ApiProperty({ description: 'JWT access, живёт 15 мин' })
  accessToken!: string;

  @ApiProperty({ description: 'JWT refresh, живёт 30 дней, ротируется при каждом /refresh' })
  refreshToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class MessageDto {
  @ApiProperty({ example: 'Если аккаунт с таким email существует — код отправлен' })
  message!: string;
}

export class ResetTokenDto {
  @ApiProperty({ description: 'Одноразовый токен для reset-password (15 мин)' })
  resetToken!: string;
}

export class UsernameAvailableDto {
  @ApiProperty({ example: 'eraj_dev' })
  userName!: string;

  @ApiProperty({ example: true, description: 'true — свободно, можно регистрироваться' })
  available!: boolean;
}
