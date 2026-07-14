import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** ТЗ §7: пароль ≥ 8 символов. */
const PASSWORD_MIN = 8;
/** Как в IG: латиница, цифры, точка и подчёркивание. */
const USERNAME_RE = /^[a-zA-Z0-9._]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

export class RegisterDto {
  @ApiProperty({ example: 'eraj_dev', minLength: 3, maxLength: 30 })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(USERNAME_RE, {
    message: 'userName: только латиница, цифры, точка и подчёркивание',
  })
  userName!: string;

  @ApiProperty({ example: 'Eraj Karimov' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  fullName!: string;

  @ApiProperty({
    example: 'eraj@example.com',
    description: 'ОБЯЗАТЕЛЕН: только на email уходит код сброса пароля (SMS у нас нет)',
  })
  @IsEmail({}, { message: 'email: некорректный адрес' })
  email!: string;

  @ApiPropertyOptional({
    example: '+992901234567',
    description: 'Опционален. Если юзер вписал в форму телефон — сохраняем и его',
  })
  @IsOptional()
  @Matches(PHONE_RE, { message: 'phone: 7–15 цифр, можно с +' })
  phone?: string;

  @ApiProperty({ example: 'Password123', minLength: PASSWORD_MIN })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `password: минимум ${PASSWORD_MIN} символов` })
  @MaxLength(72, { message: 'password: максимум 72 символа (лимит bcrypt)' })
  password!: string;

  @ApiProperty({ example: 'Password123', description: 'Должен совпасть с password' })
  @IsString()
  confirmPassword!: string;

  @ApiProperty({ example: '2000-05-17', description: 'Дата рождения (День/Месяц/Год со скрина)' })
  @IsDateString({}, { message: 'dob: дата в формате YYYY-MM-DD' })
  dob!: string;
}

export class LoginDto {
  @ApiProperty({
    example: 'eraj_dev',
    description: 'userName ИЛИ email ИЛИ phone — работают все три',
  })
  @IsString()
  @IsNotEmpty()
  login!: string;

  @ApiProperty({ example: 'Password123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'refreshToken из ответа login' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'eraj@example.com' })
  @IsEmail()
  email!: string;
}

export class ResendCodeDto extends ForgotPasswordDto {}

export class VerifyCodeDto {
  @ApiProperty({ example: 'eraj@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '482913', description: '6 цифр из письма' })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'code: ровно 6 цифр' })
  code!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'resetToken из ответа verify-code (одноразовый, 15 мин)' })
  @IsString()
  @IsNotEmpty()
  resetToken!: string;

  @ApiProperty({ example: 'NewPassword123', minLength: PASSWORD_MIN })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(72)
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'Password123' })
  @IsString()
  @IsNotEmpty()
  oldPassword!: string;

  @ApiProperty({ example: 'NewPassword123', minLength: PASSWORD_MIN })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(72)
  newPassword!: string;
}

export class CheckUsernameDto {
  @ApiProperty({ example: 'eraj_dev' })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  userName!: string;
}
