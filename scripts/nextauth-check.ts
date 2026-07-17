/**
 * Живая проверка NextAuth (Auth.js v5) во фронте — ровно тот флоу, что делает
 * браузер: csrf → callback/credentials → session.
 *
 * Проверяем не «конфиг написан», а что вход реально происходит ЧЕРЕЗ наш бэкенд
 * и что токен НЕ утёк в сессию (в этом приложении ничего токеноподобного не
 * должно доходить до клиентского JS).
 *
 * Запуск: NEXTAUTH_URL=http://localhost:3000 npx ts-node scripts/nextauth-check.ts
 * (фронт и бэкенд должны быть подняты; фронт смотрит на этот же бэкенд).
 */
const FRONT = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
const BASE = `${FRONT}/api/nextauth`;
const API = process.env.SMOKE_URL ?? 'http://127.0.0.1:4000/api';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, note = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${note}`);
  }
}

/** Куки между запросами — как в браузере. */
const jar = new Map<string, string>();
function saveCookies(res: Response): void {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
const cookieHeader = (): string =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function main(): Promise<void> {
  console.log(`\n▶ NextAuth: ${BASE}\n  backend: ${API}\n`);

  // ── юзери тоза дар бэкенд
  const uniq = Date.now().toString(36);
  const user = {
    userName: `na_${uniq}`,
    fullName: 'NextAuth Check',
    email: `na_${uniq}@example.com`,
    password: 'Passw0rd!23',
    confirmPassword: 'Passw0rd!23',
    dob: '2000-01-01',
  };
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  const regJson = (await reg.json()) as { data?: { user?: { id?: string } } };
  check('юзер дар бэкенд сохта шуд', reg.ok && !!regJson.data?.user?.id, `→ ${reg.status}`);

  // ── 1. providers
  const provRes = await fetch(`${BASE}/providers`);
  const providers = (await provRes.json()) as Record<string, { type?: string }>;
  check('provider-и credentials эълон шудааст', providers?.credentials?.type === 'credentials', JSON.stringify(providers));

  // ── 2. csrf (бе он NextAuth POST-ро рад мекунад)
  const csrfRes = await fetch(`${BASE}/csrf`);
  saveCookies(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  check('csrf-token гирифта шуд', typeof csrfToken === 'string' && csrfToken.length > 0);

  // ── 3. логини НОДУРУСТ бояд рад шавад
  const badBody = new URLSearchParams({
    csrfToken,
    login: user.userName,
    password: 'WrongPassword!1',
    callbackUrl: FRONT,
  });
  const badRes = await fetch(`${BASE}/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body: badBody,
    redirect: 'manual',
  });
  const badLocation = badRes.headers.get('location') ?? '';
  check(
    'пароли нодуруст рад мешавад',
    badLocation.includes('error') || badRes.status === 401,
    `→ ${badRes.status} ${badLocation}`,
  );

  // Сессия ҳанӯз набояд бошад.
  const noSessRes = await fetch(`${BASE}/session`, { headers: { Cookie: cookieHeader() } });
  const noSess = (await noSessRes.json()) as { user?: unknown };
  check('баъди логини нодуруст сессия НЕСТ', !noSess?.user, JSON.stringify(noSess));

  // ── 4. логини ДУРУСТ
  const okBody = new URLSearchParams({
    csrfToken,
    login: user.userName,
    password: user.password,
    callbackUrl: FRONT,
  });
  const okRes = await fetch(`${BASE}/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body: okBody,
    redirect: 'manual',
  });
  saveCookies(okRes);
  const okLocation = okRes.headers.get('location') ?? '';
  check(
    'логини дуруст қабул шуд (бе error)',
    !okLocation.includes('error'),
    `→ ${okRes.status} ${okLocation}`,
  );
  check(
    'куки сессия гузошта шуд',
    [...jar.keys()].some((k) => k.includes('session-token')),
    [...jar.keys()].join(', '),
  );

  // ── 5. сессия — воқеан ҳамон юзер?
  const sessRes = await fetch(`${BASE}/session`, { headers: { Cookie: cookieHeader() } });
  const sess = (await sessRes.json()) as {
    user?: { id?: string; userName?: string; name?: string };
    accessToken?: string;
    refreshToken?: string;
  };
  check('сессия юзерро медиҳад', !!sess?.user, JSON.stringify(sess));
  check('id-и юзер аз бэкенд аст', sess?.user?.id === regJson.data?.user?.id, `${sess?.user?.id} vs ${regJson.data?.user?.id}`);
  check('userName дар сессия ҳаст', sess?.user?.userName === user.userName, JSON.stringify(sess?.user));

  // ── 6. ГЛАВНОЕ: токен НАБОЯД дар сессия бошад
  const raw = JSON.stringify(sess);
  check(
    'accessToken ба сессия НАРАФТААСТ (ба JS намерасад)',
    !('accessToken' in (sess ?? {})) && !raw.includes('eyJhbGciOi'),
    raw.slice(0, 200),
  );
  check('refreshToken ҳам дар сессия НЕСТ', !('refreshToken' in (sess ?? {})));

  // ── 7. logout
  const outRes = await fetch(`${BASE}/signout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, callbackUrl: FRONT }),
    redirect: 'manual',
  });
  saveCookies(outRes);
  const afterOut = await fetch(`${BASE}/session`, { headers: { Cookie: cookieHeader() } });
  const afterOutJson = (await afterOut.json()) as { user?: unknown };
  check('баъди signout сессия хомӯш', !afterOutJson?.user, JSON.stringify(afterOutJson));

  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e: Error) => {
  console.error('💥', e.message);
  process.exit(1);
});
