/**
 * Живая проверка заметок (2026-07-17): аудитория, лайки, ответы → в чат, музыка.
 *
 * Главное здесь — `audience`. Его не было вообще: любая заметка была видна всем
 * подписчикам, выбор «близкие друзья» показать было нечем. Проверяем не только
 * ленту (её фильтр), но и прямой заход по id: без отдельной проверки «близкие
 * друзья» обходились бы перебором id.
 *
 * Запуск: npm run notes:check   (API должен быть поднят)
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
  console.log('\n▶ Санҷиши заметкаҳо\n');

  const author = await registerUser('nt', 'author');
  const close = await registerUser('nt', 'close'); // дӯсти наздик
  const plain = await registerUser('nt', 'plain'); // танҳо обуначӣ

  // Ҳар ду ба author обуна мешаванд (author публикӣ аст → ACCEPTED дарҳол)
  await req('POST', `/follow/${author.id}`, {}, close.token);
  await req('POST', `/follow/${author.id}`, {}, plain.token);
  // author танҳо `close`-ро ба наздикон меандозад
  const addClose = await req('POST', `/close-friends/${close.id}`, {}, author.token);
  check('дӯсти наздик илова шуд', [200, 201].includes(addClose.status), `→ ${addClose.status}`);

  // ── 1. Заметка барои ҲАМА обуначиён
  const forAll = await req('POST', '/notes', { text: 'Салом ба ҳама 👋' }, author.token);
  check('заметкаи оддӣ сохта шуд', forAll.status === 201, JSON.stringify(forAll.json).slice(0, 150));
  check('audience пешфарз FOLLOWERS', forAll.json?.data?.audience === 'FOLLOWERS', JSON.stringify(forAll.json?.data?.audience));

  const plainFeed = await req('GET', '/notes', undefined, plain.token);
  check(
    'обуначии оддӣ заметкаи FOLLOWERS-ро мебинад',
    (plainFeed.json?.data ?? []).some((n: any) => n.author.id === author.id),
  );

  // ── 2. Заметка танҳо барои НАЗДИКОН
  const forClose = await req(
    'POST',
    '/notes',
    { text: 'Танҳо ба наздикон 🤫', audience: 'CLOSE_FRIENDS' },
    author.token,
  );
  const closeNoteId: number = forClose.json?.data?.id;
  check('заметкаи CLOSE_FRIENDS сохта шуд', forClose.status === 201 && forClose.json?.data?.audience === 'CLOSE_FRIENDS', JSON.stringify(forClose.json?.data));

  // ЛЕНТА: наздик мебинад, оддӣ НЕ
  const closeFeed = await req('GET', '/notes', undefined, close.token);
  check(
    'дӯсти наздик онро дар лента МЕБИНАД',
    (closeFeed.json?.data ?? []).some((n: any) => n.id === closeNoteId),
    JSON.stringify((closeFeed.json?.data ?? []).map((n: any) => n.id)),
  );

  const plainFeed2 = await req('GET', '/notes', undefined, plain.token);
  check(
    'обуначии оддӣ онро дар лента НАМЕБИНАД',
    !(plainFeed2.json?.data ?? []).some((n: any) => n.id === closeNoteId),
    JSON.stringify((plainFeed2.json?.data ?? []).map((n: any) => n.id)),
  );

  // РОҲИ РОСТ бо id — сӯрохи асосӣ
  const direct = await req('GET', `/notes/${closeNoteId}`, undefined, plain.token);
  check('оддӣ бо id-и рост ҳам гирифта НАМЕТАВОНАД → 404', direct.status === 404, `→ ${direct.status}`);

  const directClose = await req('GET', `/notes/${closeNoteId}`, undefined, close.token);
  check('наздик бо id-и рост мегирад → 200', directClose.status === 200, `→ ${directClose.status}`);

  // Лайк ҳам бояд баста бошад
  const likeByPlain = await req('POST', `/notes/${closeNoteId}/like`, {}, plain.token);
  check('оддӣ лайк карда НАМЕТАВОНАД → 404', likeByPlain.status === 404, `→ ${likeByPlain.status}`);

  // ── 3. Лайк аз наздик + автор мебинад КӢ лайк кард (модалка)
  const likeByClose = await req('POST', `/notes/${closeNoteId}/like`, {}, close.token);
  check('наздик лайк мекунад', likeByClose.json?.data?.liked === true, JSON.stringify(likeByClose.json?.data));

  const likesList = await req('GET', `/notes/${closeNoteId}/likes`, undefined, author.token);
  const liker = likesList.json?.data?.[0]?.user;
  check('автор рӯйхати лайккардаҳоро мебинад', likesList.status === 200 && !!liker, JSON.stringify(likesList.json).slice(0, 150));
  check('дар рӯйхат профил ҳаст (userName + avatar)', !!liker?.userName && 'avatarUrl' in liker, JSON.stringify(liker));

  const likesByOther = await req('GET', `/notes/${closeNoteId}/likes`, undefined, close.token);
  check('каси дигар рӯйхати лайкҳоро НАМЕБИНАД → 403', likesByOther.status === 403, `→ ${likesByOther.status}`);

  // ── 4. Ҷавоб ба заметка → ба ЧАТ меояд
  const reply = await req('POST', `/notes/${closeNoteId}/reply`, { text: 'Чӣ хел трек?' }, close.token);
  const chatId = reply.json?.data?.chatId;
  check('ҷавоб фиристода шуд ва чат сохт', reply.status === 201 && !!chatId, JSON.stringify(reply.json).slice(0, 150));

  const authorChats = await req('GET', '/chats', undefined, author.token);
  const chat = (authorChats.json?.data ?? []).find((c: any) => c.id === chatId);
  check('чат дар рӯйхати АВТОР пайдо шуд', !!chat, 'чат нест!');
  check('паёми охирин ҳамон ҷавоб аст', chat?.lastMessage?.text === 'Чӣ хел трек?', JSON.stringify(chat?.lastMessage?.text));
  check('навъи паём NOTE_REPLY аст', chat?.lastMessage?.type === 'NOTE_REPLY', JSON.stringify(chat?.lastMessage?.type));
  check('noteSnapshot нигоҳ дошта шуд (заметка мемирад, паём мемонад)', !!chat?.lastMessage?.noteSnapshot, JSON.stringify(chat?.lastMessage?.noteSnapshot));

  const replies = await req('GET', `/notes/${closeNoteId}/replies`, undefined, author.token);
  check('автор ҷавобҳоро мебинад', replies.status === 200 && (replies.json?.data ?? []).length >= 1, `→ ${replies.status}`);

  // ── 5. Музика дар заметка (треки маҳаллӣ — бо расм ва ном)
  const music = await req('GET', '/music?limit=1', undefined, author.token);
  const track = music.json?.data?.items?.[0];
  if (track) {
    const withMusic = await req('POST', '/notes', { text: 'Ин трек 🎧', musicId: track.id }, author.token);
    const m = withMusic.json?.data?.music;
    check('заметка бо музика сохта шуд', withMusic.status === 201 && !!m, JSON.stringify(withMusic.json).slice(0, 150));
    check('музика ном ва расм дорад', !!m?.title && !!m?.artist && !!m?.coverUrl, JSON.stringify(m));
    check('треки маҳаллӣ isFullTrack=true', m?.isFullTrack === true, JSON.stringify(m));
  }

  // ── 6. Танҳо як заметкаи фаъол (мисли IG)
  const feedAuthor = await req('GET', '/notes', undefined, author.token);
  const mine = (feedAuthor.json?.data ?? []).filter((n: any) => n.isMine);
  check('як юзер = як заметкаи фаъол', mine.length === 1, `ёфт шуд: ${mine.length}`);

  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e: Error) => {
  console.error('💥', e.message);
  process.exit(1);
});
