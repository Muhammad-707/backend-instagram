/**
 * Общее HTTP-хозяйство для живых скриптов проверки (socket-check, live-check).
 *
 * Зачем отдельный модуль:
 * 1. Оба скрипта регистрируют юзеров, а на auth-роутах стоит rate-limit 5/мин
 *    (это верное поведение прода, не баг). Когда скрипты идут цепочкой в
 *    `verify:all` после smoke, квота уже израсходована и регистрация ловит 429 —
 *    проверка падала не из-за бага, а из-за собственной спешки. Ждём и повторяем.
 * 2. Раньше ошибка звучала как «регистрация нашуд» и прятала настоящую причину;
 *    выяснять, что там 429, приходилось руками через curl. Теперь статус и тело
 *    ответа видно сразу.
 */

export interface HttpRes {
  status: number;
  json: any;
}

export const BASE = process.env.SMOKE_URL ?? 'http://localhost:4000/api';
export const WS = BASE.replace(/\/api$/, '');

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<HttpRes> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

export interface TestUser {
  token: string;
  id: string;
  userName: string;
}

/**
 * Регистрация тестового юзера. На 429 ждём и повторяем — окно throttler'а 60с,
 * поэтому пауза 10с и до 9 попыток заведомо перекрывают его.
 */
export async function registerUser(prefix: string, tag: string): Promise<TestUser> {
  const userName = `${prefix}_${tag}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const payload = {
    userName,
    fullName: `Test ${tag}`,
    email: `${userName}@example.com`,
    password: 'Passw0rd!23',
    confirmPassword: 'Passw0rd!23',
    dob: '2000-01-01',
  };

  const MAX_TRIES = 9;
  for (let i = 1; i <= MAX_TRIES; i++) {
    const r = await req('POST', '/auth/register', payload);
    if (r.json?.data?.accessToken) {
      return { token: r.json.data.accessToken, id: r.json.data.user.id, userName };
    }
    if (r.status === 429) {
      if (i === 1) console.log('    (rate-limit 5/мин — интизор мешавем…)');
      await wait(10_000);
      continue;
    }
    throw new Error(`регистратсияи «${tag}» → ${r.status}: ${JSON.stringify(r.json)}`);
  }
  throw new Error(`регистратсияи «${tag}»: rate-limit ${MAX_TRIES} бор пас аз ҳам 429 дод`);
}
