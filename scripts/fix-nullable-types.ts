/**
 * Codemod: проставляет явный `type:` в @ApiProperty/@ApiPropertyOptional
 * для nullable-полей.
 *
 * Проблема. `avatarUrl?: string | null` в рантайме виден Nest'у как `Object`:
 * TS-юнион в `design:type` не переживает компиляцию. Из-за этого в Swagger
 * уезжает `{"type":"object"}` — и схема ВРЁТ: фронт, генерящий типы из
 * docs-json, получает `avatarUrl: object` вместо строки. Ровно тот класс лжи,
 * что и «gender отдаётся строкой, а принимает 0|1».
 *
 * Лечится только явным `type:` в декораторе — вывести его из TS невозможно.
 *
 * Трогаем лишь примитивы (string/number/boolean/Date). Сложные типы
 * (Record, DTO, unknown) пропускаем и печатаем списком — их правят руками.
 *
 * Запуск: npx ts-node scripts/fix-nullable-types.ts [--dry]
 */
import { readFileSync, writeFileSync } from 'fs';
import { sync as glob } from 'glob';

const DRY = process.argv.includes('--dry');

const TS_TO_SWAGGER: Record<string, string> = {
  string: 'String',
  number: 'Number',
  boolean: 'Boolean',
  Date: 'String', // date-time приезжает строкой в JSON
};

let fixed = 0;
const skipped: string[] = [];

for (const file of glob('src/**/*.dto.ts')) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let touched = false;

  for (let i = 0; i < lines.length; i++) {
    const dec = lines[i];
    if (!/@ApiProperty(Optional)?\(\{/.test(dec)) continue;
    // Декоратор в одну строку + объявление на следующей — весь наш стиль такой.
    if (!dec.trimEnd().endsWith('})')) continue;
    if (/\btype\s*:/.test(dec) || /\benum\s*:/.test(dec)) continue;

    const decl = lines[i + 1];
    if (!decl) continue;

    // name?: string | null;  /  name!: Date | null;
    const m = decl.match(/^\s*(\w+)[!?]:\s*([\w.<>, ]+?)\s*\|\s*null\s*;/);
    if (!m) continue;

    const [, field, tsTypeRaw] = m;
    const tsType = tsTypeRaw.trim();
    const swaggerType = TS_TO_SWAGGER[tsType];

    if (!swaggerType) {
      skipped.push(`${file}: ${field}?: ${tsType} | null`);
      continue;
    }

    const extra = tsType === 'Date' ? `type: String, format: 'date-time', ` : `type: ${swaggerType}, `;
    lines[i] = dec.replace(/@ApiProperty(Optional)?\(\{\s*/, (mm) => `${mm}${extra}`);
    touched = true;
    fixed++;
  }

  if (touched && !DRY) writeFileSync(file, lines.join('\n'), 'utf8');
}

console.log(`\n${DRY ? 'Было бы исправлено' : 'Исправлено'}: ${fixed} полей`);
if (skipped.length) {
  console.log(`\nПропущено (не примитив — править руками): ${skipped.length}`);
  for (const s of skipped) console.log(`  · ${s}`);
}
console.log('');
