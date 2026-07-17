/**
 * Живая проверка «найти любую песню мира» (2026-07-17).
 *
 * Раньше поиск музыки был завязан только на Spotify, а его `/search` отвечает
 * `403 Active premium subscription required for the owner of the app` — то есть
 * вся музыка в приложении зависела от подписки владельца Spotify-приложения и
 * не работала вовсе. Теперь каталог сменный, по умолчанию Deezer (без ключей).
 *
 * Проверяем весь путь так, как им пользуется человек: найти песню → отправить в
 * чат / поставить в заметку → реально услышать.
 *
 * Запуск: npm run online:check   (API должен быть поднят, нужен интернет)
 */
import { registerUser, req } from './lib/verify-http';

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

async function main(): Promise<void> {
  console.log('\n▶ Ҷустуҷӯи музика дар каталогҳои беруна\n');

  const a = await registerUser('om', 'a');
  const b = await registerUser('om', 'b');

  // ── каталогҳо
  const provs = await req('GET', '/music/online/providers', undefined, a.token);
  const providers: string[] = provs.json?.data?.providers ?? [];
  check('каталоги кор мекунанда эълон шудааст', providers.includes('DEEZER'), JSON.stringify(providers));

  // ── ҷустуҷӯи суруди воқеӣ
  const found = await req(
    'GET',
    '/music/online?q=weeknd%20blinding%20lights&limit=5',
    undefined,
    a.token,
  );
  const tracks: any[] = found.json?.data ?? [];
  check('ҷустуҷӯ ҷавоб медиҳад', found.status === 200 && tracks.length > 0, JSON.stringify(found.json).slice(0, 160));

  const hit = tracks.find((t) => /blinding lights/i.test(t.title));
  check('суруди дурустро ёфт', !!hit, JSON.stringify(tracks.map((t) => t.title)));
  if (!hit) throw new Error('трек ёфт нашуд');
  console.log(`    ёфт: «${hit.title}» — ${hit.artist} (${hit.duration}с)`);

  check('ном ва ИҶРОКУНАНДА дорад', !!hit.title && !!hit.artist);
  check('МУҚОВА дорад', typeof hit.coverUrl === 'string' && hit.coverUrl.startsWith('http'), hit.coverUrl);
  check('превю (30с) дорад', !!hit.previewUrl, String(hit.previewUrl));
  // musicId: null — ҳанӯз ворид нашуда, рақам — аллакай дар БД-и мо. Ҳарду дуруст;
  // ба «БД тоза аст» такя кардан мумкин нест — треки ҳамон номро бор дигар меёбем.
  check(
    'musicId майдон дорад (null ё id-и мо)',
    hit.musicId === null || typeof hit.musicId === 'number',
    String(hit.musicId),
  );

  // Муқова ва превю ВОҚЕАН кушода мешаванд?
  const cover = await fetch(hit.coverUrl, { method: 'GET' });
  check('муқова воқеан кушода мешавад', cover.ok && (cover.headers.get('content-type') ?? '').startsWith('image/'), `${cover.status} ${cover.headers.get('content-type')}`);

  if (hit.previewUrl) {
    const prev = await fetch(hit.previewUrl, { headers: { Range: 'bytes=0-1023' } });
    check(
      'превю воқеан садо медиҳад',
      prev.ok && (prev.headers.get('content-type') ?? '').includes('audio'),
      `${prev.status} ${prev.headers.get('content-type')}`,
    );
  }

  // ── ба ЧАТ партофтан
  const chat = await req('POST', '/chats', { receiverUserId: b.id }, a.token);
  const chatId = chat.json?.data?.chatId ?? chat.json?.data?.id;
  const sent = await req(
    'POST',
    `/chats/${chatId}/messages`,
    { provider: hit.provider, externalId: hit.externalId },
    a.token,
  );
  const msgMusic = sent.json?.data?.music;
  check('трек ба чат партофта шуд', sent.status === 201 && sent.json?.data?.type === 'MUSIC_SHARE', JSON.stringify(sent.json).slice(0, 160));
  check('дар чат ном/иҷрокунанда/муқова ҳаст', msgMusic?.title === hit.title && !!msgMusic?.coverUrl, JSON.stringify(msgMusic));
  check(
    'ростқавлона: isFullTrack=false (файли мо нест)',
    msgMusic?.isFullTrack === false && msgMusic?.streamUrl === null,
    JSON.stringify({ isFullTrack: msgMusic?.isFullTrack, streamUrl: msgMusic?.streamUrl }),
  );
  check('гиранда ҳамон трекро мебинад', !!msgMusic?.previewUrl, String(msgMusic?.previewUrl));

  // ── ба ЗАМЕТКА мондан
  const note = await req(
    'POST',
    '/notes',
    { text: 'Ин трек 🎧', provider: hit.provider, externalId: hit.externalId },
    a.token,
  );
  const noteMusic = note.json?.data?.music;
  check('трек ба заметка монда шуд', note.status === 201 && !!noteMusic, JSON.stringify(note.json).slice(0, 160));
  check('дар заметка муқова ва ном ҳаст', !!noteMusic?.coverUrl && noteMusic?.title === hit.title, JSON.stringify(noteMusic));

  // ── идемпотентӣ: такрор дубликат намесозад
  const again = await req(
    'POST',
    `/chats/${chatId}/messages`,
    { provider: hit.provider, externalId: hit.externalId },
    a.token,
  );
  check(
    'такрор дубликати трек намесозад',
    again.json?.data?.music?.id === msgMusic?.id,
    `${again.json?.data?.music?.id} vs ${msgMusic?.id}`,
  );

  // ── ҳоло дар ҷустуҷӯ ҳамчун воридшуда нишон дода мешавад
  const again2 = await req('GET', '/music/online?q=weeknd%20blinding%20lights&limit=5', undefined, a.token);
  const same = (again2.json?.data ?? []).find((t: any) => t.externalId === hit.externalId);
  check('ҷустуҷӯ musicId-и воридшударо нишон медиҳад', same?.musicId === msgMusic?.id, `${same?.musicId} vs ${msgMusic?.id}`);

  // ── сохранить
  const saved = await req('POST', '/music/online/save', { provider: hit.provider, externalId: hit.externalId }, a.token);
  check('трек ба «сохранённые» илова шуд', saved.status === 201 || saved.status === 200, `→ ${saved.status}`);
  // /profile/me/saved-music отдаёт массив, а не {items} — сверено с ответом.
  const savedList = await req('GET', '/profile/me/saved-music', undefined, a.token);
  const savedItems: any[] = Array.isArray(savedList.json?.data)
    ? savedList.json.data
    : (savedList.json?.data?.items ?? []);
  check(
    'дар рӯйхати сохранённые пайдо шуд',
    savedItems.some((m) => m.id === msgMusic?.id),
    JSON.stringify(savedItems.map((m) => m.title)),
  );

  // Худи MusicDto ҳам набояд дурӯғ гӯяд: барои треки берунӣ streamUrl → 404.
  const savedDto = saved.json?.data;
  check(
    'MusicDto-и треки берунӣ streamUrl НАМЕДИҲАД (он 404 медод)',
    savedDto?.isFullTrack === false && savedDto?.streamUrl === null && !!savedDto?.previewUrl,
    JSON.stringify({ isFullTrack: savedDto?.isFullTrack, streamUrl: savedDto?.streamUrl }),
  );

  // ── треки маҳаллӣ ҳанӯз ПУРРА
  const local = await req('GET', '/music?limit=1', undefined, a.token);
  const lt = local.json?.data?.items?.[0];
  if (lt) {
    const sentLocal = await req('POST', `/chats/${chatId}/messages`, { musicId: lt.id }, a.token);
    check(
      'треки маҳаллӣ ҳанӯз isFullTrack=true',
      sentLocal.json?.data?.music?.isFullTrack === true,
      JSON.stringify(sentLocal.json?.data?.music),
    );
  }

  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e: Error) => {
  console.error('💥', e.message);
  process.exitCode = 1;
});
