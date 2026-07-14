import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { resetCodeTemplate } from './templates/reset-code.template';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST', 'localhost');
    const port = Number(this.config.get<string>('SMTP_PORT', '1025'));
    const user = this.config.get<string>('SMTP_USER', '');
    const pass = this.config.get<string>('SMTP_PASS', '');
    this.from = this.config.get<string>('SMTP_FROM', 'Instagram <no-reply@instagram.local>');

    // Один и тот же код на dev и prod — режим решают только переменные окружения:
    //   MailHog (localhost:1025) — без TLS и без auth;
    //   Gmail (smtp.gmail.com:587) — STARTTLS + App Password.
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      // MailHog не требует логина: с пустым SMTP_USER auth не отправляем вовсе,
      // иначе nodemailer шлёт AUTH и MailHog рвёт соединение.
      auth: user ? { user, pass } : undefined,
      requireTLS: port === 587,
    });
    this.logger.log(`SMTP: ${host}:${port} ${user ? '(auth)' : '(без auth — dev)'}`);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connected');
    } catch (e) {
      // Не роняем API: почта не должна мешать остальным 130 endpoint'ам.
      this.logger.error(`SMTP verify failed: ${(e as Error).message}`);
    }
  }

  /** Письмо с 6-значным кодом сброса пароля. */
  async sendResetCode(to: string, userName: string, code: string, ttlMin: number): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: `${code} — код для сброса пароля Instagram`,
      text: `Ваш код: ${code}. Он действует ${ttlMin} минут. Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.`,
      html: resetCodeTemplate(userName, code, ttlMin),
    });
    this.logger.log(`Код сброса отправлен на ${to}`);
  }
}
