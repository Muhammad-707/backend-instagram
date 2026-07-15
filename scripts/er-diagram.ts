/**
 * Генерирует mermaid ER-диаграмму из prisma/schema.prisma.
 * Каждая связь берётся из `@relation(fields: [...])` — это владелец внешнего ключа
 * (сторона «многие»). Опциональный FK (Тип?) рисуется как 0..1.
 * Запуск: `npm run er:diagram` → печатает mermaid-блок и пишет docs/ER.mmd.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

const models: string[] = [];
const rels: string[] = [];

const modelRe = /^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm;
let m: RegExpExecArray | null;
while ((m = modelRe.exec(schema)) !== null) {
  const name = m[1];
  const body = m[2];
  models.push(name);

  // Поля с внешним ключом: `field  Type(?)  @relation(fields: [...]`
  const fieldRe = /^\s*(\w+)\s+(\w+)(\??)\s+@relation\([^)]*fields:\s*\[/gm;
  let f: RegExpExecArray | null;
  while ((f = fieldRe.exec(body)) !== null) {
    const target = f[2];
    const optional = f[3] === '?';
    // target (one) ──< name (many). Опциональный → 0..1 на стороне родителя.
    const card = optional ? '|o--o{' : '||--o{';
    rels.push(`  ${target} ${card} ${name} : has`);
  }
}

// Сущности мермейд выводит из связей; модели без единой связи объявляем явно,
// чтобы в диаграмме присутствовали все 56.
const mentioned = new Set<string>();
for (const r of rels) {
  const parts = r.trim().split(/\s+/);
  mentioned.add(parts[0]);
  mentioned.add(parts[2]);
}
const orphans = models.filter((x) => !mentioned.has(x)).map((x) => `  ${x} {\n  }`);

const compact = ['erDiagram', ...orphans, ...rels].join('\n');

writeFileSync(join(__dirname, '..', 'docs', 'ER.mmd'), compact);
// eslint-disable-next-line no-console
console.log(compact);
// eslint-disable-next-line no-console
console.error(`\n// ${models.length} моделей, ${rels.length} связей`);
