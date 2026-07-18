import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { EmailCodeType, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { JwtUser } from '../../common/decorators/current-user.decorator';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
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
  Enable2faDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  Verify2faDto,
  VerifyCodeDto,
} from './dto/auth.dto';
import {
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  otpauthUri,
  verifyTotp,
} from './totp.util';

/** Инфо об устройстве для сессий и алёрта о новом входе. */
export interface DeviceInfo {
  userAgent?: string;
  ip?: string;
}

interface TicketPayload {
  sub: string;
  jti: string;
  typ: '2fa';
}

/** ТЗ §7: bcrypt 12 rounds. */
const BCRYPT_ROUNDS = 12;
const CODE_TTL_MIN = 15;
const RESET_TOKEN_TTL_SEC = 15 * 60;
/** IG требует 13+ лет. */
const MIN_AGE_YEARS = 13;

/** Чтобы не раскрывать, есть ли такой email в базе (user enumeration). */
const GENERIC_FORGOT_MSG = 'Если аккаунт с таким email существует — код отправлен';

interface RefreshPayload {
  sub: string;
  jti: string;
}

interface ResetPayload {
  sub: string;
  jti: string;
  typ: 'reset';
}

const USER_SELECT = {
  id: true,
  userName: true,
  fullName: true,
  email: true,
  phone: true,
  dob: true,
  role: true,
  isPrivate: true,
  isVerified: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly redis: RedisService,
  ) {}

  // ─────────────────────────── register / login ───────────────────────────

  async register(dto: RegisterDto, device?: DeviceInfo): Promise<TokensDto> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Пароли не совпадают');
    }

    const dob = new Date(dto.dob);
    if (this.ageOf(dob) < MIN_AGE_YEARS) {
      throw new BadRequestException(`Регистрация доступна с ${MIN_AGE_YEARS} лет`);
    }

    // Проверяем занятость заранее, чтобы отдать понятное поле, а не голый P2002.
    await this.assertFree(dto.userName, dto.email, dto.phone);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Профиль создаём сразу — иначе GET /auth/me и весь Фаза-4 код спотыкались бы о profile: null.
    const user = await this.prisma.user.create({
      data: {
        userName: dto.userName,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone ?? null,
        passwordHash,
        dob,
        profile: { create: {} },
      },
      select: USER_SELECT,
    });

    return this.issueTokens(user, device);
  }

  async login(dto: LoginDto, device?: DeviceInfo): Promise<TokensDto | TwoFactorRequiredDto> {
    // login — это userName ИЛИ email ИЛИ phone.
    const user = await this.prisma.user.findFirst({
      where: {
        isDeleted: false,
        OR: [{ userName: dto.login }, { email: dto.login }, { phone: dto.login }],
      },
      select: { ...USER_SELECT, passwordHash: true, totpEnabled: true },
    });

    // Одинаковый 401 и при отсутствии юзера, и при неверном пароле — не подсказываем,
    // какой из двух был неправ. И это 401, а не 500 (баг старого API).
    const ok = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!ok) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    // 2FA включена — токены не выдаём, отдаём одноразовый тикет под второй шаг.
    if (user.totpEnabled) {
      return this.issueTwoFactorTicket(user.id);
    }

    // passwordHash наружу не утечёт: toDto() собирает ответ по явному списку полей.
    return this.issueTokens(user, device, true);
  }

  // ─────────────────────────── tokens ───────────────────────────

  /** Ротация: старый refresh отзывается, выдаётся новая пара. */
  async refresh(refreshToken: string): Promise<TokensDto> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET', 'change_me_refresh_secret'),
      });
    } catch {
      throw new UnauthorizedException('Refresh-токен недействителен или истёк');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(refreshToken) },
    });

    if (!stored) throw new UnauthorizedException('Refresh-токен не найден');

    if (stored.revokedAt) {
      // Повторное использование отозванного токена = токен украли.
      // Гасим ВСЕ сессии юзера — пусть логинится заново.
      await this.revokeAll(stored.userId);
      this.logger.warn(`Повторное использование отозванного refresh (userId=${stored.userId})`);
      throw new UnauthorizedException('Refresh-токен уже использован — все сессии сброшены');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh-токен истёк');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isDeleted: false },
      select: USER_SELECT,
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<MessageDto> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(refreshToken) },
    });
    // Идемпотентно: повторный logout не должен падать.
    if (stored && !stored.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
    }
    return { message: 'Вы вышли из аккаунта' };
  }

  private async issueTokens(
    user: UserRow,
    device?: DeviceInfo,
    alertNewDevice = false,
  ): Promise<TokensDto> {
    const jti = randomUUID();

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, userName: user.userName, role: user.role },
      {
        secret: this.config.get<string>('JWT_SECRET', 'change_me_access_secret'),
        expiresIn: this.ttl(this.config.get<string>('JWT_EXPIRES_IN', '15m')),
      },
    );

    const refreshToken = await this.jwt.signAsync({ sub: user.id, jti } satisfies RefreshPayload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET', 'change_me_refresh_secret'),
      expiresIn: this.ttl(this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d')),
    });

    // Новое устройство = у юзера ещё не было активной сессии с таким userAgent.
    // Проверяем ДО создания новой строки, чтобы она не «засчиталась» сама себе.
    if (alertNewDevice && device?.userAgent) {
      await this.maybeAlertNewDevice(user, device);
    }

    // В БД кладём только SHA-256 от токена: утечка таблицы не даст войти в аккаунты.
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt: this.refreshExpiry(),
        userAgent: device?.userAgent ?? null,
        ip: device?.ip ?? null,
      },
    });

    return { accessToken, refreshToken, user: this.toDto(user) };
  }

  /** Письмо «новый вход», если с этого userAgent юзер ещё не входил. Не роняет логин. */
  private async maybeAlertNewDevice(user: UserRow, device: DeviceInfo): Promise<void> {
    try {
      const seen = await this.prisma.refreshToken.findFirst({
        where: { userId: user.id, userAgent: device.userAgent },
        select: { id: true },
      });
      if (seen) return;
      await this.mail.sendLoginAlert(user.email, user.userName, device.userAgent ?? '—', device.ip ?? '—');
    } catch (e) {
      this.logger.warn(`Не удалось отправить алёрт о входе: ${(e as Error).message}`);
    }
  }

  // ─────────────────────────── сброс пароля ───────────────────────────

  async forgotPassword(dto: ForgotPasswordDto): Promise<MessageDto> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, isDeleted: false },
      select: { id: true, userName: true, email: true },
    });

    // Если юзера нет — молча возвращаем тот же текст: иначе форма «забыли пароль»
    // превращается в проверялку «есть ли такой email в Instagram».
    if (!user) return { message: GENERIC_FORGOT_MSG };

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000);

    // Старые неиспользованные коды гасим — иначе действовало бы сразу несколько.
    await this.prisma.emailCode.updateMany({
      where: { userId: user.id, type: EmailCodeType.RESET_PASSWORD, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.emailCode.create({
      data: {
        userId: user.id,
        code,
        type: EmailCodeType.RESET_PASSWORD,
        expiresAt,
      },
    });

    await this.mail.sendResetCode(user.email, user.userName, code, CODE_TTL_MIN);
    return { message: GENERIC_FORGOT_MSG };
  }

  /** resend-code — то же самое; частоту ограничивает @Throttle 1/мин на роуте. */
  async resendCode(dto: ForgotPasswordDto): Promise<MessageDto> {
    return this.forgotPassword(dto);
  }

  async verifyCode(dto: VerifyCodeDto): Promise<ResetTokenDto> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, isDeleted: false },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('Код неверен или истёк');

    const record = await this.prisma.emailCode.findFirst({
      where: {
        userId: user.id,
        type: EmailCodeType.RESET_PASSWORD,
        code: dto.code,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Один и тот же текст на «кода нет», «код чужой», «код просрочен» — не помогаем перебору.
    if (!record) throw new BadRequestException('Код неверен или истёк');

    await this.prisma.emailCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    const jti = randomUUID();
    const resetToken = await this.jwt.signAsync(
      { sub: user.id, jti, typ: 'reset' } satisfies ResetPayload,
      {
        secret: this.config.get<string>('JWT_SECRET', 'change_me_access_secret'),
        expiresIn: this.ttl(`${CODE_TTL_MIN}m`),
      },
    );

    // Одноразовость держим в Redis: JWT сам по себе переиспользуем, а этот ключ
    // удаляется при первом reset-password.
    await this.redis.set(this.resetKey(jti), user.id, RESET_TOKEN_TTL_SEC);

    return { resetToken };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<MessageDto> {
    let payload: ResetPayload;
    try {
      payload = await this.jwt.verifyAsync<ResetPayload>(dto.resetToken, {
        secret: this.config.get<string>('JWT_SECRET', 'change_me_access_secret'),
      });
    } catch {
      throw new BadRequestException('resetToken недействителен или истёк');
    }

    if (payload.typ !== 'reset') {
      // Иначе обычным access-токеном можно было бы менять пароль без старого пароля.
      throw new BadRequestException('resetToken недействителен');
    }

    // del вернёт 0, если ключа нет → токен уже использован или протух.
    const consumed = await this.redis.del(this.resetKey(payload.jti));
    if (consumed === 0) {
      throw new BadRequestException('resetToken уже использован или истёк');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: payload.sub },
      data: { passwordHash },
    });

    // Пароль сменился — старые сессии больше не действуют.
    await this.revokeAll(payload.sub);
    return { message: 'Пароль изменён, войдите заново' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<MessageDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');

    const ok = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Старый пароль неверен');

    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException('Новый пароль совпадает со старым');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.revokeAll(userId);

    return { message: 'Пароль изменён, войдите заново' };
  }

  // ─────────────────────────── прочее ───────────────────────────

  async checkUsername(userName: string): Promise<UsernameAvailableDto> {
    const taken = await this.prisma.user.findUnique({
      where: { userName },
      select: { id: true },
    });
    return { userName, available: !taken };
  }

  async me(user: JwtUser): Promise<AuthUserDto> {
    const row = await this.prisma.user.findFirst({
      where: { id: user.id, isDeleted: false },
      select: USER_SELECT,
    });
    if (!row) throw new UnauthorizedException('Пользователь не найден');
    return this.toDto(row);
  }

  // ─────────────────────────── 2FA (TOTP) ───────────────────────────

  /** Шаг 1: сгенерировать секрет и отдать otpauth-URI для сканирования (ещё НЕ включает 2FA). */
  async setup2fa(userId: string): Promise<TwoFactorSetupDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { userName: true, totpEnabled: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');
    if (user.totpEnabled) throw new BadRequestException('2FA уже включена');

    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
    return { secret, otpauthUri: otpauthUri(secret, user.userName) };
  }

  /** Шаг 2: подтвердить кодом → включить 2FA и выдать резервные коды (показываются один раз). */
  async enable2fa(userId: string, dto: Enable2faDto): Promise<BackupCodesDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpEnabled: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');
    if (user.totpEnabled) throw new BadRequestException('2FA уже включена');
    if (!user.totpSecret) throw new BadRequestException('Сначала вызовите POST /auth/2fa/setup');
    if (!verifyTotp(user.totpSecret, dto.code)) {
      throw new UnauthorizedException('Неверный код');
    }

    const { codes, hashes } = generateBackupCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true, backupCodes: hashes },
    });
    return { backupCodes: codes };
  }

  /** Отключить 2FA (нужен действующий код или резервный) — чистит секрет и резервные коды. */
  async disable2fa(userId: string, dto: Enable2faDto): Promise<MessageDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpEnabled: true, backupCodes: true },
    });
    if (!user || !user.totpEnabled || !user.totpSecret) {
      throw new BadRequestException('2FA не включена');
    }
    if (!(await this.consumeSecondFactor(userId, user.totpSecret, user.backupCodes, dto.code))) {
      throw new UnauthorizedException('Неверный код');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null, backupCodes: [] },
    });
    return { message: '2FA отключена' };
  }

  /** Второй шаг логина: тикет + код (TOTP или резервный) → пара токенов. */
  async verify2fa(dto: Verify2faDto, device?: DeviceInfo): Promise<TokensDto> {
    let payload: TicketPayload;
    try {
      payload = await this.jwt.verifyAsync<TicketPayload>(dto.ticket, {
        secret: this.config.get<string>('JWT_SECRET', 'change_me_access_secret'),
      });
    } catch {
      throw new UnauthorizedException('Тикет недействителен или истёк');
    }
    if (payload.typ !== '2fa') throw new UnauthorizedException('Тикет недействителен');

    // Одноразовость тикета — через Redis (как resetToken).
    const consumed = await this.redis.del(this.ticketKey(payload.jti));
    if (consumed === 0) throw new UnauthorizedException('Тикет уже использован или истёк');

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isDeleted: false },
      select: { ...USER_SELECT, totpSecret: true, totpEnabled: true, backupCodes: true },
    });
    if (!user || !user.totpEnabled || !user.totpSecret) {
      throw new UnauthorizedException('2FA не активна');
    }
    if (!(await this.consumeSecondFactor(user.id, user.totpSecret, user.backupCodes, dto.code))) {
      throw new UnauthorizedException('Неверный код');
    }
    return this.issueTokens(user, device, true);
  }

  private async issueTwoFactorTicket(userId: string): Promise<TwoFactorRequiredDto> {
    const jti = randomUUID();
    const ticket = await this.jwt.signAsync(
      { sub: userId, jti, typ: '2fa' } satisfies TicketPayload,
      {
        secret: this.config.get<string>('JWT_SECRET', 'change_me_access_secret'),
        expiresIn: this.ttl('5m'),
      },
    );
    // Живёт 5 минут; удаляется при первом verify.
    await this.redis.set(this.ticketKey(jti), userId, 5 * 60);
    return { twoFactorRequired: true, ticket };
  }

  /** Проверяет код: сначала TOTP, потом резервный (и вычёркивает использованный резервный). */
  private async consumeSecondFactor(
    userId: string,
    secret: string,
    backupCodes: string[],
    code: string,
  ): Promise<boolean> {
    if (verifyTotp(secret, code)) return true;

    const hash = hashBackupCode(code);
    if (!backupCodes.includes(hash)) return false;
    // Резервный код одноразовый — убираем его из списка.
    await this.prisma.user.update({
      where: { id: userId },
      data: { backupCodes: backupCodes.filter((h) => h !== hash) },
    });
    return true;
  }

  // ─────────────────────────── сессии ───────────────────────────

  /** Активные сессии (устройства). Текущую помечаем, если прислан её refresh-токен. */
  async listSessions(userId: string, currentRefreshToken?: string): Promise<SessionDto[]> {
    const currentHash = currentRefreshToken ? this.hash(currentRefreshToken) : null;
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tokenHash: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      userAgent: r.userAgent,
      ip: r.ip,
      current: currentHash !== null && r.tokenHash === currentHash,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }));
  }

  /** Завершить конкретную сессию (только свою) — её refresh перестаёт работать. */
  async revokeSession(userId: string, sessionId: string): Promise<MessageDto> {
    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true },
    });
    if (!session || session.userId !== userId) throw new NotFoundException('Сессия не найдена');
    if (!session.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });
    }
    return { message: 'Сессия завершена' };
  }

  /** Выйти со всех устройств, КРОМЕ текущего (его refresh прислали в теле). */
  async logoutAllExceptCurrent(
    userId: string,
    currentRefreshToken: string,
  ): Promise<LogoutAllResultDto> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, tokenHash: { not: this.hash(currentRefreshToken) } },
      data: { revokedAt: new Date() },
    });
    return { revoked: count };
  }

  private ticketKey(jti: string): string {
    return `2fa:${jti}`;
  }

  // ─────────────────────────── helpers ───────────────────────────

  private toDto(user: UserRow): AuthUserDto {
    return {
      id: user.id,
      userName: user.userName,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      dob: user.dob,
      role: user.role,
      isPrivate: user.isPrivate,
      isVerified: user.isVerified,
      avatarUrl: user.profile?.avatarUrl ?? null,
    };
  }

  private async assertFree(userName: string, email: string, phone?: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ userName }, { email }, ...(phone ? [{ phone }] : [])],
      },
      select: { userName: true, email: true, phone: true },
    });
    if (!existing) return;

    if (existing.userName === userName) throw new ConflictException('userName уже занят');
    if (existing.email === email) throw new ConflictException('email уже зарегистрирован');
    throw new ConflictException('phone уже зарегистрирован');
  }

  private async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** randomInt — криптостойкий, в отличие от Math.random(). */
  private generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * jsonwebtoken типизирует expiresIn как литералы вида '15m' | '30d' (ms.StringValue),
   * а из ConfigService приходит обычный string — сужаем в одном месте.
   */
  private ttl(raw: string): JwtSignOptions['expiresIn'] {
    return raw as JwtSignOptions['expiresIn'];
  }

  private resetKey(jti: string): string {
    return `reset:${jti}`;
  }

  private refreshExpiry(): Date {
    const raw = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d');
    const days = Number(raw.replace(/\D/g, '')) || 30;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private ageOf(dob: Date): number {
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age;
  }
}
