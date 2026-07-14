import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, JwtUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import {
  AuthUserDto,
  MessageDto,
  ResetTokenDto,
  TokensDto,
  UsernameAvailableDto,
} from './dto/auth-response.dto';
import {
  ChangePasswordDto,
  CheckUsernameDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResendCodeDto,
  ResetPasswordDto,
  VerifyCodeDto,
} from './dto/auth.dto';

/** ТЗ §7: login/register/forgot — 5/мин (глобально стоит 100/мин). */
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
/** ТЗ §5.1: resend-code — 1/мин. */
const RESEND_THROTTLE = { default: { limit: 1, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary: 'Регистрация',
    description:
      'email ОБЯЗАТЕЛЕН (на него уходит код сброса пароля), phone — опционален. ' +
      'Возвращает сразу пару токенов — юзер попадает в ленту без отдельного логина.',
  })
  @ApiCreatedResponse({ type: TokensDto })
  @ApiConflictResponse({ description: 'userName / email / phone уже заняты' })
  @ApiTooManyRequestsResponse({ description: 'Больше 5 запросов в минуту' })
  async register(@Body() dto: RegisterDto): Promise<TokensDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: 'Вход по userName ИЛИ email ИЛИ phone' })
  @ApiOkResponse({ type: TokensDto })
  @ApiUnauthorizedResponse({ description: 'Неверный логин или пароль (401, не 500)' })
  @ApiTooManyRequestsResponse({ description: 'Больше 5 запросов в минуту' })
  async login(@Body() dto: LoginDto): Promise<TokensDto> {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обновить пару токенов',
    description:
      'Ротация: старый refresh отзывается. Повторное использование → все сессии сброшены.',
  })
  @ApiOkResponse({ type: TokensDto })
  @ApiUnauthorizedResponse({ description: 'Токен истёк, не найден или уже использован' })
  async refresh(@Body() dto: RefreshDto): Promise<TokensDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выход — отзыв refresh-токена (идемпотентно)' })
  @ApiOkResponse({ type: MessageDto })
  async logout(@Body() dto: RefreshDto): Promise<MessageDto> {
    return this.authService.logout(dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary: 'Отправить 6-значный код на email',
    description:
      'Ответ одинаков и для существующего, и для несуществующего email — чтобы форму нельзя ' +
      'было использовать как проверку «есть ли такой аккаунт».',
  })
  @ApiOkResponse({ type: MessageDto })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageDto> {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('resend-code')
  @HttpCode(HttpStatus.OK)
  @Throttle(RESEND_THROTTLE)
  @ApiOperation({ summary: 'Выслать код повторно (не чаще 1 раза в минуту)' })
  @ApiOkResponse({ type: MessageDto })
  @ApiTooManyRequestsResponse({ description: 'Не чаще 1 раза в минуту' })
  async resendCode(@Body() dto: ResendCodeDto): Promise<MessageDto> {
    return this.authService.resendCode(dto);
  }

  @Public()
  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: 'Проверить код → одноразовый resetToken (15 мин)' })
  @ApiOkResponse({ type: ResetTokenDto })
  async verifyCode(@Body() dto: VerifyCodeDto): Promise<ResetTokenDto> {
    return this.authService.verifyCode(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary: 'Задать новый пароль по resetToken',
    description: 'resetToken одноразовый. После смены все refresh-сессии отзываются.',
  })
  @ApiOkResponse({ type: MessageDto })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageDto> {
    return this.authService.resetPassword(dto);
  }

  @Put('change-password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Сменить пароль (нужен старый)' })
  @ApiOkResponse({ type: MessageDto })
  @ApiUnauthorizedResponse({ description: 'Старый пароль неверен или нет токена' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageDto> {
    return this.authService.changePassword(userId, dto);
  }

  @Public()
  @Post('check-username')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Свободен ли userName (live-валидация формы регистрации)' })
  @ApiOkResponse({ type: UsernameAvailableDto })
  async checkUsername(@Body() dto: CheckUsernameDto): Promise<UsernameAvailableDto> {
    return this.authService.checkUsername(dto.userName);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Текущий пользователь + профиль' })
  @ApiOkResponse({ type: AuthUserDto })
  @ApiUnauthorizedResponse({ description: 'Нет или истёк access-токен' })
  async me(@CurrentUser() user: JwtUser): Promise<AuthUserDto> {
    return this.authService.me(user);
  }
}
