/**
 * Живая проверка серверной части звонков (2026-07-17).
 *
 * До этого на бэкенде существовал ровно один endpoint — `POST /chats/:id/call`,
 * который создавал CallSession со статусом RINGING. Ответить, отклонить или
 * завершить было НЕЧЕМ: статусы ONGOING/ENDED/MISSED/DECLINED в enum'е были, но
 * их никто никогда не выставлял, а `MsgType.CALL` не использовался вообще —
 * истории звонков в переписке не существовало.
 *
 * Медиа-поток (микрофон/камера) проверить скриптом нельзя — это работа браузера.
 * Здесь проверяется всё остальное: жизненный цикл, длительность, пропущенные,
 * строки в чате и ICE-конфиг для WebRTC.
 *
 * Запуск: npm run calls:check   (API должен быть поднят)
 */
import { io, Socket } from 'socket.io-client';
import { registerUser, req, wait, WS } from './lib/verify-http';

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

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(`${WS}/rt`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () =>
      setTimeout(() => (s.connected ? resolve(s) : reject(new Error('kicked'))), 500),
    );
    s.on('connect_error', (e) => reject(e));
  });
}

async function main(): Promise<void> {
  console.log('\n▶ Санҷиши зангҳо (тарафи backend)\n');

  const a = await registerUser('cl', 'a'); // занг мезанад
  const b = await registerUser('cl', 'b'); // ҷавоб медиҳад
  const c = await registerUser('cl', 'c'); // бегона

  const chat = await req('POST', '/chats', { receiverUserId: b.id }, a.token);
  const chatId: number = chat.json?.data?.chatId ?? chat.json?.data?.id;
  if (!chatId) throw new Error('чат нашуд: ' + JSON.stringify(chat.json));

  // ── ICE
  const ice = await req('GET', '/chats/calls/ice-servers', undefined, a.token);
  const servers = ice.json?.data?.iceServers;
  check('ICE-серверҳо дода мешаванд', ice.status === 200 && Array.isArray(servers) && servers.length > 0, JSON.stringify(ice.json));
  check('STUN дар рӯйхат ҳаст', JSON.stringify(servers).includes('stun:'), JSON.stringify(servers));
  check(
    'hasTurn ростқавлона гуфта мешавад',
    typeof ice.json?.data?.hasTurn === 'boolean',
    JSON.stringify(ice.json?.data?.hasTurn),
  );

  const sockA = await connect(a.token);
  const sockB = await connect(b.token);
  const gotB: Record<string, any> = {};
  const gotA: Record<string, any> = {};
  for (const ev of ['call:incoming', 'call:answered', 'call:ended', 'call:declined']) {
    sockB.on(ev, (p: unknown) => (gotB[ev] = p));
    sockA.on(ev, (p: unknown) => (gotA[ev] = p));
  }

  // ── 1. Занги муқаррарӣ: занг → ҷавоб → анҷом
  const started = await req('POST', `/chats/${chatId}/call?type=AUDIO`, {}, a.token);
  const callId: string = started.json?.data?.callId;
  check('занг сар шуд (RINGING)', started.json?.data?.status === 'RINGING', JSON.stringify(started.json?.data));
  await wait(700);
  check('ба гиранда call:incoming расид', gotB['call:incoming']?.callId === callId, JSON.stringify(gotB['call:incoming']));

  // Занги худро ҷавоб додан мумкин нест
  const selfAnswer = await req('POST', `/chats/calls/${callId}/answer`, {}, a.token);
  check('занги худро ҷавоб додан → 400', selfAnswer.status === 400, `→ ${selfAnswer.status}`);

  // Бегона ба занги дигарон даст расонда наметавонад
  const strangerEnd = await req('POST', `/chats/calls/${callId}/end`, {}, c.token);
  check('бегона занги дигаронро анҷом дода НАМЕТАВОНАД', strangerEnd.status === 404, `→ ${strangerEnd.status}`);

  const answered = await req('POST', `/chats/calls/${callId}/answer`, {}, b.token);
  check('трубка гирифта шуд → ONGOING', answered.json?.data?.status === 'ONGOING', JSON.stringify(answered.json?.data));
  check('answeredAt гузошта шуд', !!answered.json?.data?.answeredAt);
  await wait(700);
  check('занговар call:answered гирифт', gotA['call:answered']?.callId === callId, JSON.stringify(gotA['call:answered']));

  await wait(2200); // «сӯҳбат»
  const ended = await req('POST', `/chats/calls/${callId}/end`, {}, a.token);
  const dur = ended.json?.data?.durationSec;
  check('занг анҷом ёфт → ENDED', ended.json?.data?.status === 'ENDED', JSON.stringify(ended.json?.data));
  check('дарозии сӯҳбат ҳисоб шуд (≈2с)', dur >= 2 && dur < 10, `durationSec=${dur}`);
  await wait(600);
  check('ҳарду call:ended гирифтанд', !!gotB['call:ended'] && !!gotA['call:ended']);

  // Такрори end — набояд хато диҳад
  const again = await req('POST', `/chats/calls/${callId}/end`, {}, b.token);
  check('такрори end идемпотентӣ (хато не)', again.status === 200 || again.status === 201, `→ ${again.status}`);

  // Сатр дар чат
  const msgs = await req('GET', `/chats/${chatId}/messages`, undefined, b.token);
  const callMsg = (msgs.json?.data?.items ?? []).find((m: any) => m.type === 'CALL');
  check('дар чат сатри занг пайдо шуд', !!callMsg, 'сатр нест');
  check('сатр навъ ва дарозиро дорад', callMsg?.call?.status === 'ENDED' && callMsg?.call?.durationSec >= 2, JSON.stringify(callMsg?.call));

  // ── 2. Занги ҶАВОБ НАДОДА → MISSED (на «сӯҳбати 0 сония»)
  const miss = await req('POST', `/chats/${chatId}/call?type=VIDEO`, {}, a.token);
  const missId: string = miss.json?.data?.callId;
  await wait(500);
  const missEnded = await req('POST', `/chats/calls/${missId}/end`, {}, a.token);
  check('трубкаро нагирифтанд → MISSED', missEnded.json?.data?.status === 'MISSED', JSON.stringify(missEnded.json?.data));
  check('дарозии занги ҷавобнадода = 0', missEnded.json?.data?.durationSec === 0, `durationSec=${missEnded.json?.data?.durationSec}`);

  // ── 3. Рад кардан → DECLINED
  const dec = await req('POST', `/chats/${chatId}/call?type=AUDIO`, {}, a.token);
  const decId: string = dec.json?.data?.callId;
  await wait(400);
  const declined = await req('POST', `/chats/calls/${decId}/decline`, {}, b.token);
  check('рад карда шуд → DECLINED', declined.json?.data?.status === 'DECLINED', JSON.stringify(declined.json?.data));
  await wait(600);
  check('занговар call:declined гирифт', gotA['call:declined']?.callId === decId, JSON.stringify(gotA['call:declined']));

  // ── 4. Таърих
  const hist = await req('GET', `/chats/${chatId}/calls`, undefined, a.token);
  const items = hist.json?.data?.items ?? [];
  const statuses = items.map((x: any) => x.status);
  check('таърихи зангҳо ҳар се зангро дорад', items.length >= 3, JSON.stringify(statuses));
  check(
    'ҳар се ҳолат сабт шуд: ENDED, MISSED, DECLINED',
    ['ENDED', 'MISSED', 'DECLINED'].every((s) => statuses.includes(s)),
    JSON.stringify(statuses),
  );

  sockA.close();
  sockB.close();
  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e: Error) => {
  console.error('💥', e.message);
  process.exit(1);
});
