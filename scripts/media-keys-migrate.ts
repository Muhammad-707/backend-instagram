/**
 * Миграция данных: абсолютные URL медиа → ключи.
 *
 * Зачем. Раньше в БД писался абсолютный URL (`http://localhost:9000/instagram/...`).
 * Он привязывает записи к домену: после переезда ломались не только картинки —
 * StorageService.keyFromUrl() сравнивал строку с текущим base и на старых
 * записях возвращал null, из-за чего перставали работать стрим музыки и
 * удаление файлов из S3.
 *
 * Теперь put() возвращает ключ, и в БД кладётся ключ. Этот скрипт приводит уже
 * записанные строки к тому же виду.
 *
 * Безопасность:
 *  · идемпотентен — ключ повторно не трогается (keyFromUrl вернёт его же);
 *  · читать данные это не ломает и без миграции: publicUrlFor() понимает оба
 *    формата. Скрипт наводит порядок, а не «чинит прод».
 *
 * Запуск:  npx ts-node -r dotenv/config scripts/media-keys-migrate.ts
 *          npx ts-node -r dotenv/config scripts/media-keys-migrate.ts --dry
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');

const BUCKET = process.env.S3_BUCKET ?? 'instagram';

const PUBLIC_URL = (process.env.S3_PUBLIC_URL ?? '').replace(/\/+$/, '');

/**
 * Ссылка ведёт в НАШЕ хранилище? Критично: сиды кладут в те же поля картинки
 * с i.pravatar.cc и picsum.photos. Тронуть их — значит превратить
 * `https://picsum.photos/seed/x/1080` в ключ `seed/x/1080` и убить картинку.
 * Тот же признак, что в StorageService.isOwnUrl.
 */
function isOwn(value: string): boolean {
  if (PUBLIC_URL && `${value}/`.startsWith(`${PUBLIC_URL}/`)) return true;
  try {
    return new URL(value).pathname.includes(`/${BUCKET}/`);
  } catch {
    return false;
  }
}

/** Тот же разбор, что в StorageService.keyFromUrl — но без DI, скрипт автономен. */
function keyOf(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '');
  if (!isOwn(value)) return value; // чужая — не трогаем
  let path: string;
  try {
    path = new URL(value).pathname;
  } catch {
    return value;
  }
  const marker = `/${BUCKET}/`;
  const at = path.indexOf(marker);
  return at >= 0 ? path.slice(at + marker.length) : path.replace(/^\/+/, '');
}

interface Target {
  model: string;
  fields: string[];
  /** PK не везде `id`: у Profile это userId. */
  pk: string;
}

const TARGETS: Target[] = [
  { model: 'profile', fields: ['avatarUrl'], pk: 'userId' },
  { model: 'postMedia', fields: ['url', 'thumbUrl'], pk: 'id' },
  { model: 'music', fields: ['url', 'coverUrl'], pk: 'id' },
  { model: 'collection', fields: ['coverUrl'], pk: 'id' },
  { model: 'story', fields: ['mediaUrl', 'thumbUrl'], pk: 'id' },
  { model: 'highlight', fields: ['coverUrl'], pk: 'id' },
  { model: 'message', fields: ['mediaUrl'], pk: 'id' },
  { model: 'live', fields: ['coverUrl'], pk: 'id' },
];

async function main(): Promise<void> {
  console.log(`\n▶ Миграция URL → ключ${DRY ? ' (--dry: только показать)' : ''}\n`);
  let total = 0;

  for (const { model, fields, pk } of TARGETS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = (prisma as any)[model];
    for (const field of fields) {
      const rows: Array<Record<string, string | null>> = await repo.findMany({
        where: { [field]: { startsWith: 'http' } },
        select: { [pk]: true, [field]: true },
      });
      let changed = 0;
      let sample = '';
      for (const row of rows) {
        const before = row[field];
        if (!before) continue;
        const after = keyOf(before);
        if (after === before) continue; // ключ или чужая ссылка
        if (!DRY) {
          await repo.update({ where: { [pk]: row[pk] }, data: { [field]: after } });
        }
        if (!sample) sample = `${before}  →  ${after}`;
        changed++;
        total++;
      }
      const foreign = rows.length - changed;
      console.log(
        `  ${changed ? '✔' : '·'} ${model}.${field}: ${changed} → ключ` +
          (foreign ? `, ${foreign} чужих оставлено` : '') +
          (sample ? `
      ${sample}` : ''),
      );
    }
  }

  console.log(`\n${DRY ? 'Было бы обновлено' : 'Обновлено'}: ${total} значений\n`);
}

main()
  .catch((e) => {
    console.error('Миграция упала:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
