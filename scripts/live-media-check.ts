/**
 * Эфир: проверка ПРОТИВ НАСТОЯЩЕГО сервера LiveKit (2026-07-17).
 *
 * Раньше про эфир честно говорилось «медиа проверить нельзя, нужен браузер», и
 * на этом проверка заканчивалась — то есть не было доказано даже то, что наш
 * токен вообще принимают. Оказалось, доказать можно почти всё, кроме самих
 * RTP-пакетов:
 *
 *   1. Токен подключается к сигнальному WS LiveKit (`/rtc?access_token=…`).
 *      Подпись неверна или комната не та → сервер рвёт соединение. Значит,
 *      успешный JOIN — это проверка токена САМИМ LiveKit, а не нами.
 *   2. Комната реально появляется в LiveKit (RoomServiceClient.listRooms).
 *   3. Участник реально виден в комнате, и его права (`canPublish`) — те, что
 *      выдал наш бэкенд: хост publisher, зритель — нет. Это проверяет уже
 *      LiveKit, а не наш код.
 *   4. `POST /live/:id/end` реально закрывает комнату на сервере.
 *
 * Не покрыто здесь физически: сами аудио/видео-пакеты — для них нужен WebRTC-стек
 * (браузер). Всё, что до них, доказано настоящим сервером.
 *
 * Запуск: npm run live:media   (API + LiveKit должны быть подняты)
 */
import { PrismaClient } from '@prisma/client';
import { RoomServiceClient } from 'livekit-server-sdk';
import WebSocket from 'ws';
import { registerUser, req, wait } from './lib/verify-http';

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

const LK_URL = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
const LK_KEY = process.env.LIVEKIT_API_KEY ?? 'devkey';
const LK_SECRET = process.env.LIVEKIT_API_SECRET ?? 'secret';
const httpUrl = LK_URL.replace(/^ws/, 'http');

/**
 * Подключение к сигнальному каналу LiveKit тем же токеном, что получает фронт.
 * Резолвится 'joined', если сервер принял и прислал JoinResponse; 'rejected' —
 * если закрыл соединение (плохой токен/права).
 */
function signalConnect(wsUrl: string, token: string): Promise<'joined' | 'rejected'> {
  return new Promise((resolve) => {
    const url = `${wsUrl}/rtc?access_token=${encodeURIComponent(token)}&protocol=15&auto_subscribe=true&sdk=js&version=2.7.0`;
    const ws = new WebSocket(url);
    let settled = false;
    const done = (r: 'joined' | 'rejected'): void => {
      if (settled) return;
      settled = true;
      resolve(r);
      // Соединение держим открытым чуть дольше — участник должен успеть
      // появиться в listParticipants, иначе проверим пустую комнату.
      setTimeout(() => ws.close(), 2500);
    };

    // Первое же сообщение от LiveKit — JoinResponse: сервер принял токен.
    ws.on('message', () => done('joined'));
    ws.on('error', () => done('rejected'));
    ws.on('close', () => done('rejected'));
    setTimeout(() => done('rejected'), 8000);
  });
}

async function main(): Promise<void> {
  console.log(`\n▶ Эфир ↔ LiveKit-и воқеӣ: ${LK_URL}\n`);

  const rooms = new RoomServiceClient(httpUrl, LK_KEY, LK_SECRET);
  const prisma = new PrismaClient();

  // LiveKit умуман зинда аст?
  const before = await rooms.listRooms().catch((e: Error) => e);
  check('LiveKit дастрас аст (API ҷавоб медиҳад)', Array.isArray(before), String(before));

  const host = await registerUser('lm', 'host');
  const viewer = await registerUser('lm', 'viewer');
  await req('POST', `/follow/${host.id}`, {}, viewer.token);

  // ── эфир сар мешавад
  const started = await req('POST', '/live/start', { title: 'media-test' }, host.token);
  const liveId: string = started.json?.data?.live?.id ?? started.json?.data?.id;
  const hostToken: string = started.json?.data?.token;
  const wsUrl: string = started.json?.data?.wsUrl;
  check('эфир сар шуд ва токен дод', started.status === 201 && !!hostToken, JSON.stringify(started.json).slice(0, 160));
  check('wsUrl ба фронт дода мешавад', typeof wsUrl === 'string' && wsUrl.startsWith('ws'), String(wsUrl));

  // ── ГЛАВНОЕ: токени ХОСТ-ро худи LiveKit қабул мекунад?
  const hostJoin = await signalConnect(wsUrl ?? LK_URL, hostToken);
  check('LiveKit токени хостро ҚАБУЛ кард (JOIN)', hostJoin === 'joined', `→ ${hostJoin}`);

  // ── тамошобин
  const joined = await req('POST', `/live/${liveId}/join`, {}, viewer.token);
  const viewerToken: string = joined.json?.data?.token;
  check('тамошобин токен гирифт', joined.status === 200 || joined.status === 201, `→ ${joined.status}`);
  const viewerJoin = await signalConnect(wsUrl ?? LK_URL, viewerToken);
  check('LiveKit токени тамошобинро ҚАБУЛ кард', viewerJoin === 'joined', `→ ${viewerJoin}`);

  await wait(1200);

  // roomName — отдельный UUID (`live-${randomUUID()}`), а НЕ live.id: угадывать
  // его по liveId нельзя, берём из БД — так проверка привязана к настоящей комнате.
  const row = await prisma.live.findUnique({ where: { id: liveId }, select: { roomName: true } });
  const roomName = row?.roomName;
  check('roomName дар БД ҳаст', !!roomName, String(roomName));

  // ── комната воқеан дар LiveKit ҳаст?
  const list = await rooms.listRooms();
  const room = list.find((r) => r.name === roomName);
  check(
    'комната дар LiveKit воқеан сохта шуд',
    !!room,
    `интизор: ${roomName}; ҳаст: ${JSON.stringify(list.map((r) => r.name))}`,
  );

  if (room) {
    const parts = await rooms.listParticipants(room.name);
    check('иштирокчиён дар комната воқеан ҳастанд', parts.length >= 1, `${parts.length} нафар`);

    // Грантҳоро ХУДИ LiveKit тафтиш кардааст, на мо.
    const publishers = parts.filter((p) => p.permission?.canPublish === true);
    const subscribers = parts.filter((p) => p.permission?.canPublish === false);
    check(
      'хост дар LiveKit ҳуқуқи ПАХШ дорад (canPublish=true)',
      publishers.length >= 1,
      JSON.stringify(parts.map((p) => ({ id: p.identity, pub: p.permission?.canPublish }))),
    );
    check(
      'тамошобин ҳуқуқи пахш НАДОРАД (canPublish=false)',
      subscribers.length >= 1,
      JSON.stringify(parts.map((p) => ({ id: p.identity, pub: p.permission?.canPublish }))),
    );
  }

  // ── анҷом: комната воқеан баста мешавад?
  await req('POST', `/live/${liveId}/end`, {}, host.token);
  await wait(1500);
  const after = await rooms.listRooms();
  const stillThere = after.find((r) => r.name === roomName);
  check(
    'баъди end комната дар LiveKit баста шуд',
    !!roomName && !stillThere,
    JSON.stringify(after.map((r) => r.name)),
  );
  await prisma.$disconnect();

  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e: Error) => {
  console.error('💥', e.message);
  process.exit(1);
});
