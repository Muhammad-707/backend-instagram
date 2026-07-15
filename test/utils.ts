import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

/**
 * Поднимает полное приложение с тем же глобальным конвейером, что и main.ts
 * (prefix /api, ValidationPipe, ResponseInterceptor, AllExceptionsFilter).
 * ThrottlerGuard отключён: e2e делает десятки auth-запросов подряд, а прод-лимит
 * 5/мин на /auth/* — его проверяем отдельно живым curl'ом в отчёте фазы.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

/** Реальный JPEG (проходит magic-byte валидацию upload'а и обработку sharp). */
export function jpegBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 210, g: 90, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}

let seq = 0;
/** Уникальный userName из [a-z0-9] (проходит USERNAME_RE), ≤30 символов. */
export function uniqueName(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`.toLowerCase().slice(0, 28);
}

export interface TestUser {
  id: string;
  userName: string;
  accessToken: string;
  refreshToken: string;
}

/** Регистрирует нового юзера и возвращает токены + id. */
export async function registerUser(app: INestApplication, prefix: string): Promise<TestUser> {
  const userName = uniqueName(prefix);
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      userName,
      fullName: 'E2E Test',
      email: `${userName}@example.com`,
      password: 'Password123',
      confirmPassword: 'Password123',
      dob: '2000-01-01',
    })
    .expect(201);

  const data = res.body.data as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  };
  return {
    id: data.user.id,
    userName,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

/** Bearer-заголовок для supertest. */
export function auth(user: TestUser): string {
  return `Bearer ${user.accessToken}`;
}
