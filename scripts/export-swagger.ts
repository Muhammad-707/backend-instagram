/**
 * Экспорт OpenAPI-схемы в docs/swagger.json без запущенного сервера.
 * Тот же DocumentBuilder, что и в main.ts. Запуск: `npm run swagger:export`.
 */
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  // Сервер для swagger.json: SWAGGER_SERVER_URL → APP_URL → продакшн-плейсхолдер.
  // Пустой servers[] заставляет фронт/кодоген бить в localhost — поэтому всегда задаём.
  const serverUrl = (
    process.env.SWAGGER_SERVER_URL ||
    process.env.APP_URL ||
    'https://<ваш-сервис>.onrender.com'
  ).replace(/\/+$/, '');

  const config = new DocumentBuilder()
    .setTitle('Instagram Backend API')
    .setDescription('NestJS + Prisma + PostgreSQL. Конверт ответа: { data, errors, statusCode }')
    .setVersion('1.0')
    .addServer(serverUrl, 'Сервер API (SWAGGER_SERVER_URL / APP_URL)')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'access-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const out = join(__dirname, '..', 'docs', 'swagger.json');
  writeFileSync(out, JSON.stringify(document, null, 2));

  const ops = Object.values(document.paths).reduce(
    (n, methods) => n + Object.keys(methods).length,
    0,
  );
  // eslint-disable-next-line no-console
  console.log(`swagger.json записан: ${Object.keys(document.paths).length} путей, ${ops} операций`);
  await app.close();
  process.exit(0);
}

void main();
