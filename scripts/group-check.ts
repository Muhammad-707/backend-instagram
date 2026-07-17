/**
 * Живая проверка групповых чатов (2026-07-17).
 *
 * Проверяем ровно то, чего раньше не было вообще: группу нельзя было создать,
 * а `GET /chats` отсекал группы фильтром `isGroup: false`. Плюс два места, где
 * групповая логика ломается тихо:
 *   · сообщение уходило `[peer.id]` — в группе его получал ровно ОДИН человек;
 *   · «печатает…» приходил голым userId, без аватара и имени.
 *
 * Запуск: npm run group:check   (API должен быть поднят)
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
  console.log(`\n▶ Санҷиши чати гурӯҳӣ: ${WS}\n`);

  const a = await registerUser('grp', 'a'); // созанда = админ
  const b = await registerUser('grp', 'b');
  const c = await registerUser('grp', 'c');
  const d = await registerUser('grp', 'd'); // баъдтар илова мешавад

  // ── сохтани гурӯҳ
  const tooFew = await req('POST', '/chats/group', { userIds: [b.id] }, a.token);
  check('як нафар → 400 (ин чати 1:1 аст)', tooFew.status === 400, `→ ${tooFew.status}`);

  const created = await req(
    'POST',
    '/chats/group',
    { title: 'Дӯстон', userIds: [b.id, c.id] },
    a.token,
  );
  const chatId: number = created.json?.data?.id;
  check(
    'гурӯҳ сохта шуд (3 нафар)',
    created.status === 201 && created.json?.data?.participantsCount === 3,
    JSON.stringify(created.json),
  );
  if (!chatId) throw new Error('гурӯҳ сохта нашуд');

  // ── дар рӯйхат дида мешавад? (пештар филтр онро мепартофт)
  const listB = await req('GET', '/chats', undefined, b.token);
  const groupInList = (listB.json?.data ?? []).find((x: any) => x.id === chatId);
  check('гурӯҳ дар GET /chats-и узв ҳаст', !!groupInList, 'дар рӯйхат нест!');
  check('isGroup=true ва title дуруст', groupInList?.isGroup === true && groupInList?.title === 'Дӯстон');
  check('peer=null, participants=2 (ғайр аз худам)', groupInList?.peer === null && groupInList?.participants?.length === 2);
  check('админ танҳо созанда аст', groupInList?.isAdmin === false);

  const listA = await req('GET', '/chats', undefined, a.token);
  const forA = (listA.json?.data ?? []).find((x: any) => x.id === chatId);
  check('созанда isAdmin=true мебинад', forA?.isAdmin === true);

  // ── паём ба ҲАМА мерасад (пештар танҳо ба як нафар)
  const sockB = await connect(b.token);
  const sockC = await connect(c.token);
  let bGot: any = null;
  let cGot: any = null;
  let bTyping: any = null;
  sockB.on('message:new', (p: any) => { if (p.chatId === chatId && p.type === 'TEXT') bGot = p; });
  sockC.on('message:new', (p: any) => { if (p.chatId === chatId && p.type === 'TEXT') cGot = p; });
  sockB.on('typing:start', (p: any) => (bTyping = p));
  await wait(400);

  await req('POST', `/chats/${chatId}/messages`, { text: 'Салом ба ҳама' }, a.token);
  await wait(1200);
  check('паём ба узви 1 расид', bGot?.text === 'Салом ба ҳама', JSON.stringify(bGot));
  check('паём ба узви 2 расид (fan-out)', cGot?.text === 'Салом ба ҳама', JSON.stringify(cGot));

  // ── «печатает…» бо аватар ва ном
  sockC.emit('typing:start', chatId);
  await wait(900);
  check('typing аватар ва ном дорад', !!bTyping?.user && 'avatarUrl' in bTyping.user, JSON.stringify(bTyping));
  check('typing displayName дорад', typeof bTyping?.user?.displayName === 'string', JSON.stringify(bTyping?.user));

  // ── илова: узви одӣ метавонад
  const addByB = await req('POST', `/chats/${chatId}/participants`, { userIds: [d.id] }, b.token);
  check('узви одӣ одам илова карда метавонад', addByB.status === 201 || addByB.status === 200, `→ ${addByB.status}`);

  // ── хориҷ: узви одӣ НАМЕТАВОНАД, админ метавонад
  const kickByB = await req('DELETE', `/chats/${chatId}/participants/${d.id}`, undefined, b.token);
  check('узви одӣ хориҷ карда НАМЕТАВОНАД → 403', kickByB.status === 403, `→ ${kickByB.status}`);

  const kickByA = await req('DELETE', `/chats/${chatId}/participants/${d.id}`, undefined, a.token);
  check('админ хориҷ карда метавонад', kickByA.status === 200, `→ ${kickByA.status}`);

  // ── номивазкунӣ
  const rename = await req('PUT', `/chats/${chatId}/title`, { title: 'Наши' }, b.token);
  check('узв номро иваз карда метавонад', rename.status === 200, `→ ${rename.status}`);

  // ── presence-и узвҳо дар detail
  const detail = await req('GET', `/chats/${chatId}`, undefined, a.token);
  const p0 = detail.json?.data?.participants?.[0];
  check('detail: ҳар узв isOnline дорад', typeof p0?.isOnline === 'boolean', JSON.stringify(p0));
  check('detail: узви онлайн ҳақиқатан онлайн аст', detail.json?.data?.participants?.some((x: any) => x.isOnline === true), 'ҳеҷ кас онлайн нест?');

  // ── паёмҳои системавӣ
  const msgs = await req('GET', `/chats/${chatId}/messages`, undefined, a.token);
  const sys = (msgs.json?.data?.items ?? []).filter((m: any) => m.type === 'SYSTEM');
  check('паёмҳои системавӣ ҳастанд', sys.length >= 3, `ёфт шуд: ${sys.length}`);
  console.log('    сис. паёмҳо:', sys.map((s: any) => s.text).reverse().join(' | '));

  // ── музика дар гурӯҳ (треки маҳаллӣ — пурра, бо streamUrl)
  const music = await req('GET', '/music?limit=1', undefined, a.token);
  const track = music.json?.data?.items?.[0];
  if (track) {
    const sent = await req('POST', `/chats/${chatId}/messages`, { musicId: track.id }, a.token);
    const m = sent.json?.data;
    check('трек ба гурӯҳ фиристода шуд', sent.status === 201 && m?.type === 'MUSIC_SHARE', JSON.stringify(sent.json).slice(0, 200));
    check('трек title/artist/cover дорад', !!m?.music?.title && !!m?.music?.artist, JSON.stringify(m?.music));
    check('треки маҳаллӣ isFullTrack=true ва streamUrl дорад', m?.music?.isFullTrack === true && !!m?.music?.streamUrl, JSON.stringify(m?.music));

    // Воқеан гӯш карда мешавад?
    // streamUrl аз APP_URL сохта мешавад (домени публикӣ), вале скрипт метавонад
    // ба порти дигар зада бошад — origin-ро ба ҳамони санҷидашаванда мегардонем,
    // вагарна ба сервиси бегона мезанем ва 404-и бегонаро ба API мебандем.
    if (m?.music?.streamUrl) {
      const path = new URL(m.music.streamUrl).pathname;
      const res = await fetch(`${new URL(WS).origin}${path}`, {
        headers: { Range: 'bytes=0-1023' },
      });
      check('streamUrl воқеан садо медиҳад (206)', res.status === 206, `→ ${res.status}`);
    }
  } else {
    console.log('    (треки маҳаллӣ нест — қисми музика гузаронда шуд)');
  }

  // ── баромадан
  const leave = await req('POST', `/chats/${chatId}/leave`, {}, c.token);
  check('узв аз гурӯҳ баромада метавонад', leave.status === 201 || leave.status === 200, `→ ${leave.status}`);
  const listC = await req('GET', '/chats', undefined, c.token);
  check('баъди баромадан гурӯҳ дар рӯйхаташ нест', !(listC.json?.data ?? []).some((x: any) => x.id === chatId));

  sockB.close();
  sockC.close();

  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e: Error) => {
  console.error('💥', e.message);
  process.exit(1);
});
