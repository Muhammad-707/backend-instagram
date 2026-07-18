import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
  BackupCodesDto,
  LogoutAllResultDto,
  MessageDto,
  ResetTokenDto,
  SessionDto,
  TokensDto,
  TwoFactorRequiredDto,
  TwoFactorSetupDto,
  UsernameAvailableDto,
} from './dto/auth-response.dto';
import {
  ChangePasswordDto,
  CheckUsernameDto,
  Disable2faDto,
  Enable2faDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutAllDto,
  RefreshDto,
  RegisterDto,
  ResendCodeDto,
  ResetPasswordDto,
  Verify2faDto,
  VerifyCodeDto,
} from './dto/auth.dto';
import { DeviceInfo } from './auth.service';

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
  async register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<TokensDto> {
    return this.authService.register(dto, device(ip, ua));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary: 'Вход по userName ИЛИ email ИЛИ phone',
    description:
      'Если у аккаунта включена 2FA — вместо токенов вернётся { twoFactorRequired: true, ticket }; ' +
      'второй шаг — POST /auth/2fa/verify с тикетом и кодом.',
  })
  @ApiOkResponse({ type: TokensDto })
  @ApiUnauthorizedResponse({ description: 'Неверный логин или пароль (401, не 500)' })
  @ApiTooManyRequestsResponse({ description: 'Больше 5 запросов в минуту' })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<TokensDto | TwoFactorRequiredDto> {
    return this.authService.login(dto, device(ip, ua));
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

  // ─────────────────────────── 2FA ───────────────────────────

  @Post('2fa/setup')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Начать настройку 2FA — вернуть секрет и otpauth-URI для QR',
    description: 'Ещё НЕ включает 2FA: сначала подтвердите кодом через /2fa/enable.',
  })
  @ApiOkResponse({ type: TwoFactorSetupDto })
  async setup2fa(@CurrentUser('id') userId: string): Promise<TwoFactorSetupDto> {
    return this.authService.setup2fa(userId);
  }

  @Post('2fa/enable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Подтвердить код → включить 2FA и получить резервные коды',
    description: 'Резервные коды показываются ОДИН раз — сохраните их.',
  })
  @ApiOkResponse({ type: BackupCodesDto })
  @ApiUnauthorizedResponse({ description: 'Неверный код' })
  async enable2fa(
    @CurrentUser('id') userId: string,
    @Body() dto: Enable2faDto,
  ): Promise<BackupCodesDto> {
    return this.authService.enable2fa(userId, dto);
  }

  @Post('2fa/disable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отключить 2FA (нужен действующий код или резервный)' })
  @ApiOkResponse({ type: MessageDto })
  @ApiUnauthorizedResponse({ description: 'Неверный код' })
  async disable2fa(
    @CurrentUser('id') userId: string,
    @Body() dto: Disable2faDto,
  ): Promise<MessageDto> {
    return this.authService.disable2fa(userId, dto);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Второй шаг логина: тикет + код → пара токенов' })
  @ApiOkResponse({ type: TokensDto })
  @ApiUnauthorizedResponse({ description: 'Тикет/код неверен или истёк' })
  async verify2fa(
    @Body() dto: Verify2faDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<TokensDto> {
    return this.authService.verify2fa(dto, device(ip, ua));
  }

  // ─────────────────────────── сессии ───────────────────────────

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Активные сессии (устройства)',
    description: 'Передайте текущий refresh-токен в ?rt=…, чтобы пометить свою сессию (current).',
  })
  @ApiOkResponse({ type: [SessionDto] })
  async sessions(
    @CurrentUser('id') userId: string,
    @Query('rt') rt?: string,
  ): Promise<SessionDto[]> {
    return this.authService.listSessions(userId, rt);
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Завершить конкретную сессию (её refresh перестаёт работать)' })
  @ApiOkResponse({ type: MessageDto })
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<MessageDto> {
    return this.authService.revokeSession(userId, id);
  }

  @Post('sessions/logout-all')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выйти со всех устройств, кроме текущего' })
  @ApiOkResponse({ type: LogoutAllResultDto })
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Body() dto: LogoutAllDto,
  ): Promise<LogoutAllResultDto> {
    return this.authService.logoutAllExceptCurrent(userId, dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Текущий пользователь',
    description:
      'Отдаёт ПЛОСКИЙ AuthUserDto — никакого конверта `{ user, profile }` нет и не было. ' +
      'Поля профиля, которые сюда входят, лежат на верхнем уровне (avatarUrl). ' +
      'Формулировка «пользователь + профиль» раньше читалась как конверт, из-за чего ' +
      'фронт разбирал оба варианта — вторая ветка не нужна. ' +
      'Полный профиль (счётчики, about, website) — GET /profile/me.',
  })
  @ApiOkResponse({ type: AuthUserDto })
  @ApiUnauthorizedResponse({ description: 'Нет или истёк access-токен' })
  async me(@CurrentUser() user: JwtUser): Promise<AuthUserDto> {
    return this.authService.me(user);
  }
}

/** Собирает DeviceInfo из запроса — userAgent обрезаем, чтобы не раздувать БД. */
function device(ip?: string, ua?: string): DeviceInfo {
  return { ip: ip || undefined, userAgent: ua ? ua.slice(0, 255) : undefined };
}
