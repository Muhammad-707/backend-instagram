/**
 * Живая проверка доступа к комнате эфира через сокет (2026-07-17).
 *
 * Причина: REST-guard закрывал `POST /live/:id/join` (заблокированному — 403),
 * но `live:subscribe` пускал в комнату кого угодно — заблокированный читал
 * `live:comment` чужого эфира в реальном времени (проверено живьём, доходило).
 *
 * Проверяем обе стороны: чужой не проходит И обычный зритель не сломан.
 *
 * Запуск: npm run live:check   (API должен быть поднят)
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

const make = (tag: string): Promise<{ token: string; id: string }> => registerUser('lv', tag);

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(`${WS}/live`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () =>
      setTimeout(() => (s.connected ? resolve(s) : reject(new Error('kicked'))), 600),
    );
    s.on('connect_error', (e) => reject(e));
  });
}

async function main(): Promise<void> {
  console.log(`\n▶ Санҷиши дастрасии эфир: ${WS}/live\n`);

  const host = await make('h');
  const viewer = await make('v');
  const blocked = await make('b');

  const live = await req('POST', '/live/start', { title: 'access-test' }, host.token);
  const liveId: string = live.json?.data?.live?.id ?? live.json?.data?.id;
  if (!liveId) throw new Error('эфир сар нашуд: ' + JSON.stringify(live.json));

  // Хост blocked-ро блок мекунад
  const blk = await req('POST', `/follow/${blocked.id}/block`, {}, host.token);
  check('блок гузошта шуд', blk.status === 201 || blk.status === 200, `→ ${blk.status}`);

  const joinBad = await req('POST', `/live/${liveId}/join`, {}, blocked.token);
  check('REST join-и блокшуда → 403', joinBad.status === 403, `→ ${joinBad.status}`);

  const joinOk = await req('POST', `/live/${liveId}/join`, {}, viewer.token);
  check('REST join-и тамошобини одӣ → 200/201', [200, 201].includes(joinOk.status), `→ ${joinOk.status}`);

  const sockBad = await connect(blocked.token);
  const sockViewer = await connect(viewer.token);

  let badGot: unknown = null;
  let viewerGot: any = null;
  sockBad.on('live:comment', (p: unknown) => (badGot = p));
  sockViewer.on('live:comment', (p: unknown) => (viewerGot = p));

  sockBad.emit('live:subscribe', liveId);
  sockViewer.emit('live:subscribe', liveId);
  await wait(900);

  await req('POST', `/live/${liveId}/comment`, { text: 'SECRET-COMMENT' }, host.token);
  await wait(1300);

  check('блокшуда рӯйдоди эфирро НАМЕГИРАД', !badGot, JSON.stringify(badGot));
  check(
    'тамошобини одӣ рӯйдодро МЕГИРАД',
    viewerGot?.text === 'SECRET-COMMENT',
    JSON.stringify(viewerGot),
  );

  await req('POST', `/live/${liveId}/end`, {}, host.token);
  sockBad.close();
  sockViewer.close();

  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e: Error) => {
  console.error('💥', e.message);
  process.exit(1);
});
