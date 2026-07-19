import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { resetCodeTemplate } from './templates/reset-code.template';

/** Аргументы универсальной отправки письма. Нужен text ИЛИ html (или оба). */
export interface MailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  /**
   * Resend HTTP API (https://api.resend.com) поверх HTTPS/443. Render блокирует
   * исходящие SMTP-порты (25/465/587), поэтому на проде почта уходит через HTTP.
   * Если RESEND_API_KEY задан — используем его; иначе падаем на SMTP (dev/MailHog).
   */
  private readonly resendApiKey: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST', 'localhost');
    const port = Number(this.config.get<string>('SMTP_PORT', '1025'));
    const user = this.config.get<string>('SMTP_USER', '');
    const pass = this.config.get<string>('SMTP_PASS', '');
    this.resendApiKey = this.config.get<string>('RESEND_API_KEY', '');
    this.from = this.config.get<string>('SMTP_FROM', 'Instagram <no-reply@instagram.local>');

    // SMTP_SECURE задаёт TLS явно ('true'/'false'). Если не задан — берём по порту:
    //   465 → implicit TLS (secure: true); 587/25/1025 → STARTTLS/без TLS (secure: false).
    const secure = this.resolveSecure(port);

    // Один и тот же код на dev и prod — режим решают только переменные окружения:
    //   MailHog (localhost:1025) — без TLS и без auth;
    //   Gmail (smtp.gmail.com:587) — STARTTLS + App Password.
    this.transporter = createTransport({
      host,
      port,
      secure,
      // MailHog не требует логина: с пустым SMTP_USER auth не отправляем вовсе,
      // иначе nodemailer шлёт AUTH и MailHog рвёт соединение.
      auth: user ? { user, pass } : undefined,
      // STARTTLS обязателен на 587, но не на implicit-TLS (465) и не на dev (1025).
      requireTLS: !secure && port === 587,
    });
    if (this.resendApiKey) {
      this.logger.log(`Mail: Resend HTTP API (from=${this.from})`);
    } else {
      this.logger.log(
        `SMTP: ${host}:${port} secure=${secure} ${user ? '(auth)' : '(без auth — dev)'}`,
      );
    }
  }

  async onModuleInit(): Promise<void> {
    // При Resend проверять нечего: SMTP-транспорт не используется, а лишний
    // verify() на проде даст ложный «Connection timeout» (SMTP-порты закрыты).
    if (this.resendApiKey) {
      this.logger.log('Mail: Resend активен, SMTP verify пропущен');
      return;
    }
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connected');
    } catch (e) {
      // Не роняем API: почта не должна мешать остальным endpoint'ам.
      this.logger.error(`SMTP verify failed: ${(e as Error).message}`);
    }
  }

  /**
   * Универсальная отправка письма. Возвращает true при успехе, false при ошибке —
   * НИКОГДА не бросает: почта не должна ронять бизнес-операцию (логин, регистрацию,
   * сброс пароля). Вызывающий сам решает, критичен ли для него результат.
   */
  async sendMail(options: MailOptions): Promise<boolean> {
    if (!options.text && !options.html) {
      this.logger.warn(`Письмо "${options.subject}" → ${options.to} без text/html — не отправлено`);
      return false;
    }
    if (this.resendApiKey) {
      return this.sendViaResend(options);
    }
    try {
      await this.transporter.sendMail({ from: this.from, ...options });
      this.logger.log(`Письмо отправлено: "${options.subject}" → ${options.to}`);
      return true;
    } catch (e) {
      this.logger.error(`Не удалось отправить письмо на ${options.to}: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Отправка через Resend REST API поверх HTTPS — без SMTP-портов, работает на Render.
   * Тело: { from, to, subject, text?, html? }. Ошибку не бросаем — логируем и вернём false.
   */
  private async sendViaResend(options: MailOptions): Promise<boolean> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [options.to],
          subject: options.subject,
          ...(options.text ? { text: options.text } : {}),
          ...(options.html ? { html: options.html } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        this.logger.error(
          `Resend не отправил письмо на ${options.to}: HTTP ${res.status} ${detail}`,
        );
        return false;
      }
      this.logger.log(`Письмо отправлено (Resend): "${options.subject}" → ${options.to}`);
      return true;
    } catch (e) {
      this.logger.error(`Resend недоступен (${options.to}): ${(e as Error).message}`);
      return false;
    }
  }

  /** Письмо с 6-значным кодом сброса пароля. */
  async sendResetCode(
    to: string,
    userName: string,
    code: string,
    ttlMin: number,
  ): Promise<boolean> {
    return this.sendMail({
      to,
      subject: `${code} — код для сброса пароля Instagram`,
      text: `Ваш код: ${code}. Он действует ${ttlMin} минут. Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.`,
      html: resetCodeTemplate(userName, code, ttlMin),
    });
  }

  /** Уведомление о входе с нового устройства. */
  async sendLoginAlert(
    to: string,
    userName: string,
    userAgent: string,
    ip: string,
  ): Promise<boolean> {
    const when = new Date().toLocaleString('ru-RU');
    return this.sendMail({
      to,
      subject: 'Новый вход в ваш аккаунт Instagram',
      text:
        `Здравствуйте, ${userName}! Мы заметили вход в ваш аккаунт с нового устройства.\n` +
        `Время: ${when}\nУстройство: ${userAgent}\nIP: ${ip}\n\n` +
        `Если это были вы — всё в порядке. Если нет — смените пароль и завершите чужие сессии в настройках.`,
    });
  }

  /**
   * secure: явный SMTP_SECURE ('true'/'false') имеет приоритет; иначе — эвристика по порту
   * (465 = implicit TLS). Пустая/некорректная строка трактуется как «не задано».
   */
  private resolveSecure(port: number): boolean {
    const raw = this.config.get<string>('SMTP_SECURE');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return port === 465;
  }
}
