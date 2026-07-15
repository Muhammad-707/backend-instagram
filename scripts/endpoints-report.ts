/**
 * Финальная сверка: читает docs/swagger.json и печатает таблицу
 * «модуль (tag) → сколько endpoint'ов → сколько под замком 🔒».
 * Источник правды — сама OpenAPI-схема, сгенерированная из контроллеров,
 * поэтому «пропустить» endpoint невозможно: чего нет в схеме — того нет в API.
 * Запуск: `npm run endpoints:report`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

interface Operation {
  tags?: string[];
  security?: unknown[];
  summary?: string;
}
interface Swagger {
  paths: Record<string, Record<string, Operation>>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function main(): void {
  const file = join(__dirname, '..', 'docs', 'swagger.json');
  const doc = JSON.parse(readFileSync(file, 'utf8')) as Swagger;

  const byTag = new Map<string, { total: number; locked: number }>();
  let total = 0;
  let locked = 0;

  for (const [, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!METHODS.includes(method)) continue;
      total += 1;
      const tag = op.tags?.[0] ?? 'untagged';
      const isLocked = Array.isArray(op.security) && op.security.length > 0;
      if (isLocked) locked += 1;
      const row = byTag.get(tag) ?? { total: 0, locked: 0 };
      row.total += 1;
      if (isLocked) row.locked += 1;
      byTag.set(tag, row);
    }
  }

  const rows = [...byTag.entries()].sort((a, b) => b[1].total - a[1].total);
  const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - s.length));

  // eslint-disable-next-line no-console
  console.log(`\n${pad('Модуль (tag)', 20)} ${pad('Endpoints', 10)} ${pad('🔒 защищено', 12)} ✅`);
  // eslint-disable-next-line no-console
  console.log('-'.repeat(52));
  for (const [tag, r] of rows) {
    // eslint-disable-next-line no-console
    console.log(`${pad(tag, 20)} ${pad(String(r.total), 10)} ${pad(String(r.locked), 12)} ✅`);
  }
  // eslint-disable-next-line no-console
  console.log('-'.repeat(52));
  // eslint-disable-next-line no-console
  console.log(`${pad('ИТОГО', 20)} ${pad(String(total), 10)} ${pad(String(locked), 12)}`);
  // eslint-disable-next-line no-console
  console.log(`\nПубличных (@Public): ${total - locked} · Под JWT: ${locked}\n`);
}

main();
