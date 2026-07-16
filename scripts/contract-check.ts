/**
 * Задача 13.2: сверка ЖИВЫХ ответов со схемой Swagger.
 *
 * Прецедент из ТЗ: на прошлом бэкенде `gender` отдавался строкой "Male", а на
 * запись принимал 0|1 — фронт узнал об этом только в проде. Ищем именно такое:
 * enum'ы, nullable, отсутствующие поля, разные типы на чтение и запись.
 *
 * Схема — docs/swagger.json (сгенерирована из DTO), ответ — живой HTTP.
 * Расхождение = баг: врёт либо схема, либо код.
 *
 * Запуск: npx ts-node scripts/contract-check.ts
 */
import Ajv, { ErrorObject } from 'ajv';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4000/api';
const doc = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'swagger.json'), 'utf8'));

// strict:false — в схеме Nest есть ключи, которых ajv не знает (например example).
const ajv = new Ajv({ strict: false, allErrors: true });

/**
 * OpenAPI 3.0 → JSON Schema.
 *
 * `nullable: true` — диалект OpenAPI, ajv о нём не знает и на `null` ругается
 * там, где null легален. Без этой правки каждое nullable-поле дало бы ложное
 * «расхождение», и настоящие потерялись бы в шуме.
 */
function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (node === null || typeof node !== 'object') return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) out[k] = toJsonSchema(v);

  if (out.nullable === true) {
    // `nullable + allOf: [$ref]` — так OpenAPI 3.0 выражает «ссылка или null».
    // В JSON Schema это anyOf: иначе allOf требует совпадения с DTO, и легальный
    // null считается ошибкой (ложное расхождение на каждом посте без локации).
    if (Array.isArray(out.allOf)) {
      const refs = out.allOf;
      delete out.allOf;
      delete out.nullable;
      delete out.type;
      return { ...out, anyOf: [...refs, { type: 'null' }] };
    }
    if (typeof out.type === 'string') {
      out.type = [out.type, 'null'];
      delete out.nullable;
    }
  }
  return out;
}

const components = toJsonSchema(doc.components) as object;

let ok = 0;
const problems: string[] = [];

/** Схема ответа 200/201 для операции. */
function schemaFor(path: string, method: string): unknown {
  const op = doc.paths?.[path]?.[method];
  const res = op?.responses?.['200'] ?? op?.responses?.['201'];
  return res?.content?.['application/json']?.schema;
}

function validate(name: string, path: string, method: string, data: unknown): void {
  const schema = schemaFor(path, method);
  if (!schema) {
    problems.push(`${name}: дар Swagger схемаи ҷавоб НЕСТ (${method.toUpperCase()} ${path})`);
    return;
  }

  // Курсорные списки: контроллер объявлен как [Dto], а реально отдаёт
  // { items, nextCursor, hasMore }. Это известное расхождение — проверяем items.
  let target = data;
  if (
    data !== null &&
    typeof data === 'object' &&
    'items' in (data as object) &&
    (schema as { type?: string }).type === 'array'
  ) {
    target = (data as { items: unknown }).items;
  }

  // $ref внутри указывают на #/components/schemas/... — резолвятся от КОРНЯ
  // компилируемого документа, поэтому components кладём рядом со схемой.
  const wrapper = { ...(toJsonSchema(schema) as object), components };
  const validateFn = ajv.compile(wrapper);
  if (validateFn(target)) {
    ok++;
    return;
  }
  const errs = (validateFn.errors ?? []) as ErrorObject[];
  const brief = errs
    .slice(0, 4)
    .map((e) => `${e.instancePath || '/'} ${e.message}`)
    .join('; ');
  problems.push(`${name} (${method.toUpperCase()} ${path}): ${brief}`);
}

async function api(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return (await res.json()).data;
}

async function main(): Promise<void> {
  console.log(`\n▶ Сверка ответа со схемой: ${BASE}\n`);

  const login = await api('POST', '/auth/login', { login: 'behruz', password: 'Password123' });
  const token: string = login?.accessToken;
  if (!token) throw new Error('behruz бо Password123 даромада нашуд — seed лозим');

  const me = await api('GET', '/auth/me', undefined, token);
  validate('auth/me', '/api/auth/me', 'get', me);

  const profile = await api('GET', '/profile/me', undefined, token);
  validate('profile/me', '/api/profile/me', 'get', profile);

  const posts = await api('GET', '/posts?limit=5', undefined, token);
  validate('posts', '/api/posts', 'get', posts);

  const feed = await api('GET', '/posts/feed?limit=5', undefined, token);
  validate('posts/feed', '/api/posts/feed', 'get', feed);

  const reels = await api('GET', '/posts/reels?limit=5', undefined, token);
  validate('posts/reels', '/api/posts/reels', 'get', reels);

  const stories = await api('GET', '/stories', undefined, token);
  validate('stories', '/api/stories', 'get', stories);

  const chats = await api('GET', '/chats?limit=5', undefined, token);
  validate('chats', '/api/chats', 'get', chats);

  const notifs = await api('GET', '/notifications?limit=5', undefined, token);
  validate('notifications', '/api/notifications', 'get', notifs);

  const music = await api('GET', '/music?limit=3', undefined, token);
  validate('music', '/api/music', 'get', music);

  const users = await api('GET', '/users?q=a&limit=3', undefined, token);
  validate('users', '/api/users', 'get', users);

  const suggestions = await api('GET', '/users/suggestions', undefined, token);
  validate('users/suggestions', '/api/users/suggestions', 'get', suggestions);

  const cols = await api('GET', '/profile/me/collections', undefined, token);
  validate('profile/me/collections', '/api/profile/me/collections', 'get', cols);

  const activity = await api('GET', '/profile/me/activity?limit=5', undefined, token);
  validate('profile/me/activity', '/api/profile/me/activity', 'get', activity);

  const views = await api('GET', '/notifications/profile-views?limit=5', undefined, token);
  validate('profile-views', '/api/notifications/profile-views', 'get', views);

  const explore = await api('GET', '/search/explore?limit=5', undefined, token);
  validate('search/explore', '/api/search/explore', 'get', explore);

  const top = await api('GET', '/search/top?q=a', undefined, token);
  validate('search/top', '/api/search/top', 'get', top);

  const health = await api('GET', '/health');
  validate('health', '/api/health', 'get', health);

  console.log(`Мувофиқ:      ${ok}`);
  console.log(`Номувофиқ:    ${problems.length}`);
  if (problems.length) {
    console.log('\n──── РАСХОЖДЕНИЯ (схема ↔ реальность) ────');
    for (const p of problems) console.log(`  ✗ ${p}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
