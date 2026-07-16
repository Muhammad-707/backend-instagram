/**
 * Живая проверка авторизации сокета и событий (задача 3).
 * Запуск: npx ts-node scripts/socket-check.ts   (API должен быть поднят)
 */
import { io, Socket } from 'socket.io-client';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4000/api';
const WS = BASE.replace(/\/api$/, '');

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

async function api(path: string, body: unknown, token?: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return (await res.json()).data;
}

/**
 * Подключение с готовым auth-объектом. Резолвится 'connected' | 'rejected'.
 *
 * Важно: событие 'connect' у клиента срабатывает ДО того, как сервер успевает
 * разорвать соединение в handleConnection. Поэтому нельзя считать «connect =
 * пустили»: сначала так и вышло — тест показывал, что пускают даже без auth.
 * Ждём и смотрим, жив ли сокет через паузу.
 */
const SETTLE_MS = 700;

function connect(auth: Record<string, string>): Promise<{ status: string; socket: Socket }> {
  return new Promise((resolve) => {
    const socket = io(`${WS}/rt`, { auth, transports: ['websocket'], reconnection: false });
    const settle = (): void =>
      resolve({ status: socket.connected ? 'connected' : 'rejected', socket });

    socket.on('connect', () => setTimeout(settle, SETTLE_MS));
    socket.on('connect_error', () => resolve({ status: 'rejected', socket }));
    setTimeout(() => resolve({ status: 'timeout', socket }), 5000);
  });
}

async function main(): Promise<void> {
  console.log(`\n▶ Санҷиши сокет: ${WS}/rt\n`);
  const uniq = Date.now().toString().slice(-8);

  const u1 = {
    userName: `sock_a_${uniq}`,
    fullName: 'Sock A',
    email: `sock_a_${uniq}@example.com`,
    password: 'Passw0rd!23',
    confirmPassword: 'Passw0rd!23',
    dob: '2000-01-01',
  };
  const reg = await api('/auth/register', u1);
  const token: string = reg?.accessToken;
  if (!token) throw new Error('регистрация нашуд');

  // 1) Тикет мегирем
  const t = await api('/socket/ticket', {}, token);
  check('POST /socket/ticket тикет медиҳад', typeof t?.ticket === 'string' && t.expiresInSec === 30, JSON.stringify(t));

  // 2) Пайвасти якум бо тикет — бояд шавад
  const first = await connect({ ticket: t.ticket });
  check('пайваст бо тикет', first.status === 'connected', `→ ${first.status}`);
  first.socket.disconnect();

  // 3) ҲАМОН тикет дубора — бояд РАД шавад (якдафъаина!)
  const second = await connect({ ticket: t.ticket });
  check('тикети такрорӣ рад мешавад', second.status === 'rejected', `→ ${second.status}`);
  second.socket.disconnect();

  // 4) Тикети сохта — рад
  const fake = await connect({ ticket: '00000000-0000-0000-0000-000000000000' });
  check('тикети бегона рад мешавад', fake.status === 'rejected', `→ ${fake.status}`);
  fake.socket.disconnect();

  // 5) Роҳи кӯҳна (token) бояд кор кунад — вагарна клиентҳои мавҷуда мешикананд
  const byToken = await connect({ token });
  check('auth.token ҳанӯз кор мекунад', byToken.status === 'connected', `→ ${byToken.status}`);
  byToken.socket.disconnect();

  // 6) Бе ҳеҷ чиз — рад
  const anon = await connect({});
  check('бе auth рад мешавад', anon.status === 'rejected', `→ ${anon.status}`);
  anon.socket.disconnect();

  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
