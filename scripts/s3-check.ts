/* eslint-disable no-console */
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  S3 / MinIO credential checker — проверяет ключи ДО заливки в Render.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Делает РОВНО то, что делает StorageService на проде (тот же клиент `minio`,
 *  тот же порядок), поэтому «прошло тут → пройдёт на Render»:
 *    1. connect + bucketExists         (здесь падают неверные ключи)
 *    2. makeBucket, если нет           (нужны права на создание)
 *    3. setBucketPolicy public-read    (медиа отдаётся как <img src>)
 *    4. putObject тестового файла       (проверка записи)
 *    5. HTTP GET по S3_PUBLIC_URL       (аноним читает объект — как браузер)
 *    6. removeObject                    (уборка за собой)
 *
 *  Как запускать (значения берутся из .env ИЛИ из переменных окружения):
 *
 *    npx ts-node scripts/s3-check.ts
 *
 *  Чтобы проверить НОВЫЕ ключи, не трогая рабочий .env — впишите кандидатов в
 *  .env временно, либо (bash) передайте инлайном:
 *    S3_ENDPOINT=s3.amazonaws.com S3_PORT=443 S3_USE_SSL=true \
 *    S3_ACCESS_KEY=AKIA... S3_SECRET_KEY=... S3_BUCKET=instagram \
 *    S3_PUBLIC_URL=https://instagram.s3.amazonaws.com \
 *    npx ts-node scripts/s3-check.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Client as MinioClient } from 'minio';
import * as dotenv from 'dotenv';

dotenv.config();

const cfg = {
  endPoint: process.env.S3_ENDPOINT ?? 'localhost',
  port: Number(process.env.S3_PORT ?? '9000'),
  useSSL: (process.env.S3_USE_SSL ?? 'false') === 'true',
  accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
  secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  bucket: process.env.S3_BUCKET ?? 'instagram',
  publicUrl: (process.env.S3_PUBLIC_URL ?? 'http://localhost:9000/instagram').replace(/\/+$/, ''),
};

const mask = (s: string): string => (s.length <= 6 ? '***' : `${s.slice(0, 4)}…${s.slice(-2)}`);
const ok = (m: string): void => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string): void => console.log(`  \x1b[31m✗ ${m}\x1b[0m`);
const hint = (m: string): void => console.log(`     \x1b[33m↳ ${m}\x1b[0m`);

/** Расшифровка типовых ошибок S3 в человеческий совет. */
function explain(e: unknown): void {
  const err = e as { code?: string; message?: string };
  const code = err.code ?? '';
  const msg = err.message ?? String(e);
  bad(`Ошибка: ${code || ''} ${msg}`.trim());

  if (/InvalidAccessKeyId|does not exist in our records/i.test(`${code} ${msg}`)) {
    hint('S3_ACCESS_KEY неверный (не существует у провайдера).');
    hint('AWS-ключ выглядит как AKIA... (20 символов). Если у вас другой формат —');
    hint('ключи, скорее всего, от ДРУГОГО провайдера → поставьте его S3_ENDPOINT.');
  } else if (/SignatureDoesNotMatch/i.test(code)) {
    hint('S3_SECRET_KEY не совпадает с access key. Перевыпустите пару ключей.');
  } else if (/NoSuchBucket/i.test(code)) {
    hint(`Бакета «${cfg.bucket}» нет. Создайте его в панели провайдера, либо дайте`);
    hint('ключу право s3:CreateBucket, чтобы скрипт создал его сам.');
  } else if (/AccessDenied|AllAccessDisabled/i.test(code)) {
    hint('У ключа нет прав на это действие (создание бакета / политика / запись).');
    hint('Дайте политику AmazonS3FullAccess или права на этот бакет.');
  } else if (/AuthorizationHeaderMalformed|BucketRegion|region/i.test(`${code} ${msg}`)) {
    hint('Неверный регион. Для AWS используйте региональный S3_ENDPOINT,');
    hint('например s3.eu-central-1.amazonaws.com (регион вашего бакета).');
  } else if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(`${code} ${msg}`)) {
    hint('S3_ENDPOINT недоступен: опечатка в домене или неверный порт/SSL.');
  }
}

async function main(): Promise<void> {
  console.log('\n🔎 Проверка S3-хранилища (как это делает бэкенд на проде)\n');
  console.log('  endPoint :', cfg.endPoint);
  console.log('  port     :', cfg.port, cfg.useSSL ? '(SSL)' : '(no SSL)');
  console.log('  accessKey:', mask(cfg.accessKey));
  console.log('  secretKey:', mask(cfg.secretKey));
  console.log('  bucket   :', cfg.bucket);
  console.log('  publicUrl:', cfg.publicUrl, '\n');

  // Ранняя подсказка про несоответствие формата ключа и AWS.
  if (/amazonaws\.com/i.test(cfg.endPoint) && !/^AKIA/i.test(cfg.accessKey)) {
    hint('ВНИМАНИЕ: endpoint — AWS, но access key не начинается с AKIA.');
    hint('Похоже, ключи от другого провайдера (Backblaze/R2/iDrive). Проверьте.');
    console.log('');
  }

  const client = new MinioClient({
    endPoint: cfg.endPoint,
    port: cfg.port,
    useSSL: cfg.useSSL,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
  });

  // 1. connect + bucketExists — тут падают неверные ключи ("...Access Key Id...").
  let exists = false;
  try {
    exists = await client.bucketExists(cfg.bucket);
    ok(`Подключение и ключи приняты (bucketExists → ${exists})`);
  } catch (e) {
    console.log('\n1) Подключение / ключи:');
    explain(e);
    console.log('\n\x1b[31mИТОГ: ключи или endpoint неверны — на проде будет storage: down.\x1b[0m\n');
    process.exit(1);
  }

  // 2. Бакет: создаём, если нет.
  if (!exists) {
    try {
      await client.makeBucket(cfg.bucket, 'us-east-1');
      ok(`Бакет «${cfg.bucket}» создан`);
    } catch (e) {
      console.log('\n2) Создание бакета:');
      explain(e);
      process.exit(1);
    }
  } else {
    ok(`Бакет «${cfg.bucket}» существует`);
  }

  // 3. Публичная политика на чтение (медиа отдаётся анонимно как <img src>).
  try {
    await client.setBucketPolicy(
      cfg.bucket,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${cfg.bucket}/*`],
          },
        ],
      }),
    );
    ok('Публичная политика на чтение установлена');
  } catch (e) {
    console.log('\n3) Публичная политика:');
    explain(e);
    hint('Если это AWS — снимите «Block all public access» у бакета в консоли.');
    // Не выходим: запись/чтение проверим — вдруг публичность настроена иначе (CDN).
  }

  // 4. Запись тестового объекта.
  const key = `__s3-check__/test-${Date.now()}.txt`;
  const body = Buffer.from('s3-check ok');
  try {
    await client.putObject(cfg.bucket, key, body, body.length, { 'Content-Type': 'text/plain' });
    ok(`Запись объекта работает (${key})`);
  } catch (e) {
    console.log('\n4) Запись объекта:');
    explain(e);
    process.exit(1);
  }

  // 5. Анонимное чтение по публичной ссылке — ровно так медиа грузит браузер.
  const publicLink = `${cfg.publicUrl}/${key}`;
  try {
    const res = await fetch(publicLink, { signal: AbortSignal.timeout(15000) });
    if (res.ok && (await res.text()) === 's3-check ok') {
      ok(`Публичное чтение работает: ${publicLink}`);
    } else {
      bad(`Публичная ссылка вернула HTTP ${res.status} — браузер НЕ увидит медиа`);
      hint('S3_PUBLIC_URL неверный, либо публичное чтение выключено (см. п.3).');
      hint(`Для AWS: S3_PUBLIC_URL = https://${cfg.bucket}.s3.<регион>.amazonaws.com`);
    }
  } catch (e) {
    bad(`Публичная ссылка недоступна: ${(e as Error).message}`);
    hint('Проверьте S3_PUBLIC_URL (домен, по которому объекты читаются публично).');
  }

  // 6. Уборка.
  try {
    await client.removeObject(cfg.bucket, key);
    ok('Тестовый объект удалён (уборка)');
  } catch {
    hint(`Не удалось удалить тестовый объект ${key} — удалите вручную (не критично).`);
  }

  console.log('\n\x1b[32mИТОГ: ключи рабочие. Эти же значения ставьте в Render → на проде storage: up.\x1b[0m\n');
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
