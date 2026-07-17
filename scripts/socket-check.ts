/**
 * Живая проверка авторизации сокета и событий (задача 3).
 *
 * Часть 2 (2026-07-17) — сигналинг звонков и typing. Причина: JWT отвечает
 * «кто ты», но не «твой ли это чат». Сокет верил `chatId` из payload'а, и
 * посторонний слал `call:offer` в ЧУЖОЙ чат (проверено живьём — доходило).
 * Поэтому проверяем обе стороны: чужой не проходит И свой не сломан.
 *
 * Запуск: npm run socket:check   (API должен быть поднят)
 */
import { io, Socket } from 'socket.io-client';
import { BASE, registerUser, WS } from './lib/verify-http';

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

  const { token } = await registerUser('sock', 'a');

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

  await callSignalingChecks();

  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  process.exit(failed ? 1 : 0);
}

// ─────────── зангҳо: сигналинг ва узвияти чат ───────────

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function connectToken(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(`${WS}/rt`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () =>
      setTimeout(() => (s.connected ? resolve(s) : reject(new Error('kicked'))), SETTLE_MS),
    );
    s.on('connect_error', (e) => reject(e));
  });
}

/** Три свежих юзера: A и B в общем чате, C — посторонний. */
async function callSignalingChecks(): Promise<void> {
  console.log('\n  ── сигналинг зангҳо ──');

  const a = await registerUser('call', 'a');
  const b = await registerUser('call', 'b');
  const c = await registerUser('call', 'c');

  const chat = await api('/chats', { receiverUserId: b.id }, a.token);
  const chatId: number = chat?.chatId ?? chat?.id;
  if (!chatId) throw new Error('чат сохта нашуд: ' + JSON.stringify(chat));

  const sockA = await connectToken(a.token);
  const sockB = await connectToken(b.token);
  const sockC = await connectToken(c.token);

  const got: Record<string, any> = {};
  for (const ev of ['call:offer', 'call:answer', 'call:ice', 'call:end', 'typing:start']) {
    sockB.on(ev, (p: unknown) => (got[ev] = p));
  }

  // C дар чат НЕСТ — сигналаш набояд расад.
  sockC.emit('call:offer', { chatId, sdp: { type: 'offer', sdp: 'ATTACKER' } });
  sockC.emit('typing:start', chatId);
  await wait(1000);
  check('оффери бегона НАМЕРАСАД', !got['call:offer'], JSON.stringify(got['call:offer']));
  check('typing-и бегона НАМЕРАСАД', !got['typing:start'], JSON.stringify(got['typing:start']));

  // A узви чат аст — ҳама чиз бояд кор кунад (ислоҳ зангро накуштааст).
  sockA.emit('call:offer', { chatId, sdp: { type: 'offer', sdp: 'REAL-OFFER' } });
  await wait(700);
  check(
    'оффери узви ҳақиқӣ МЕРАСАД',
    got['call:offer']?.sdp?.sdp === 'REAL-OFFER',
    JSON.stringify(got['call:offer']),
  );

  sockA.emit('call:answer', { chatId, sdp: { type: 'answer', sdp: 'REAL-ANSWER' } });
  sockA.emit('call:ice', { chatId, candidate: { candidate: 'REAL-ICE' } });
  sockA.emit('typing:start', chatId);
  await wait(700);
  check('answer мерасад', got['call:answer']?.sdp?.sdp === 'REAL-ANSWER');
  check('ice мерасад', !!got['call:ice']);
  check('typing-и узв мерасад', got['typing:start']?.userId === a.id);

  sockA.emit('call:end', { chatId });
  await wait(700);
  check('call:end мерасад', !!got['call:end']);

  sockA.close();
  sockB.close();
  sockC.close();
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
