/**
 * Живая проверка TURN — по протоколу, а не «контейнер поднялся» (2026-07-17).
 *
 * Почему так строго: TURN — единственная часть звонка, без которой всё
 * «работает на Wi-Fi и не работает с телефона». Проверять его логами или
 * `docker ps` бессмысленно: сервер может слушать порт и при этом отвергать наши
 * учётки. Поэтому говорим с ним на STUN/TURN как настоящий браузер:
 *
 *   1. Binding request → сервер отвечает нашим внешним адресом (он живой).
 *   2. Allocate БЕЗ учёток → должен быть 401 с REALM и NONCE. Это доказывает,
 *      что включён lt-cred-mech: relay не раздаётся кому попало.
 *   3. Allocate С нашими учётками (MESSAGE-INTEGRITY, ключ MD5(user:realm:pass))
 *      → 'Allocate Success' + XOR-RELAYED-ADDRESS. Вот это и есть доказательство:
 *      TURN выдал реальный relay-адрес ИМЕННО по логину/паролю из .env.
 *   4. `GET /chats/calls/ice-servers` отдаёт те же учётки и hasTurn=true.
 *
 * Запуск: npm run turn:check   (coturn + API должны быть подняты)
 */
import { createHash, createHmac, randomBytes } from 'crypto';
import { createSocket } from 'dgram';
import { req } from './lib/verify-http';

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

const HOST = process.env.TURN_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TURN_PORT ?? 3478);
const USER = process.env.TURN_USERNAME ?? 'igturn';
const PASS = process.env.TURN_PASSWORD ?? 'igturnpass';

const MAGIC = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const ALLOCATE_REQUEST = 0x0003;
const ALLOCATE_SUCCESS = 0x0103;
const ALLOCATE_ERROR = 0x0113;

const ATTR_USERNAME = 0x0006;
const ATTR_MESSAGE_INTEGRITY = 0x0008;
const ATTR_ERROR_CODE = 0x0009;
const ATTR_REALM = 0x0014;
const ATTR_NONCE = 0x0015;
const ATTR_XOR_RELAYED_ADDRESS = 0x0016;
const ATTR_REQUESTED_TRANSPORT = 0x0019;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;

function header(type: number, length: number, tid: Buffer): Buffer {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(type, 0);
  b.writeUInt16BE(length, 2);
  b.writeUInt32BE(MAGIC, 4);
  tid.copy(b, 8);
  return b;
}

/** Атрибут STUN: тип, длина, значение с добивкой до 4 байт. */
function attr(type: number, value: Buffer): Buffer {
  const pad = (4 - (value.length % 4)) % 4;
  const b = Buffer.alloc(4 + value.length + pad);
  b.writeUInt16BE(type, 0);
  b.writeUInt16BE(value.length, 2);
  value.copy(b, 4);
  return b;
}

function parseAttrs(msg: Buffer): Map<number, Buffer> {
  const out = new Map<number, Buffer>();
  let off = 20;
  while (off + 4 <= msg.length) {
    const t = msg.readUInt16BE(off);
    const l = msg.readUInt16BE(off + 2);
    out.set(t, msg.subarray(off + 4, off + 4 + l));
    off += 4 + l + ((4 - (l % 4)) % 4);
  }
  return out;
}

/** XOR-MAPPED/RELAYED-ADDRESS: порт и адрес зашифрованы magic cookie. */
function xorAddress(v: Buffer): string {
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  const ip = Buffer.from(v.subarray(4, 8));
  const cookie = Buffer.alloc(4);
  cookie.writeUInt32BE(MAGIC, 0);
  const parts = [0, 1, 2, 3].map((i) => ip[i] ^ cookie[i]);
  return `${parts.join('.')}:${port}`;
}

/**
 * ОДИН сокет на весь диалог — это не мелочь: coturn привязывает nonce к адресу
 * клиента, включая порт. Первая версия открывала новый сокет на каждый запрос,
 * и Allocate с честными учётками падал в «438 Wrong nonce» — выглядело как
 * неверный пароль, хотя дело было в смене исходящего порта.
 */
const sock = createSocket('udp4');

function send(msg: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`TURN ${HOST}:${PORT} ҷавоб надод (timeout)`)),
      5000,
    );
    const onMessage = (m: Buffer): void => {
      clearTimeout(timer);
      sock.off('message', onMessage);
      resolve(m);
    };
    sock.on('message', onMessage);
    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.send(msg, PORT, HOST);
  });
}

/** Длинные учётки: ключ = MD5(username:realm:password), подпись HMAC-SHA1. */
function withIntegrity(type: number, tid: Buffer, attrs: Buffer, realm: string): Buffer {
  const MI_SIZE = 24; // 4 (заголовок атрибута) + 20 (SHA1)
  const lengthWithMi = attrs.length + MI_SIZE;
  const toSign = Buffer.concat([header(type, lengthWithMi, tid), attrs]);
  const key = createHash('md5').update(`${USER}:${realm}:${PASS}`).digest();
  const mi = createHmac('sha1', key).update(toSign).digest();
  return Buffer.concat([header(type, lengthWithMi, tid), attrs, attr(ATTR_MESSAGE_INTEGRITY, mi)]);
}

async function main(): Promise<void> {
  console.log(`\n▶ TURN: ${HOST}:${PORT} (user=${USER})\n`);

  // ── 1. Сервер зинда аст?
  const tid1 = randomBytes(12);
  const binding = await send(header(BINDING_REQUEST, 0, tid1));
  check('TURN зинда аст (Binding response)', binding.readUInt16BE(0) === BINDING_SUCCESS, `type=0x${binding.readUInt16BE(0).toString(16)}`);
  const mapped = parseAttrs(binding).get(ATTR_XOR_MAPPED_ADDRESS);
  check('суроғаи берунаро бармегардонад', !!mapped, mapped ? xorAddress(mapped) : 'нест');
  if (mapped) console.log(`    суроғаи ман аз назари TURN: ${xorAddress(mapped)}`);

  // ── 2. Бе учётка relay набояд дода шавад
  const tid2 = randomBytes(12);
  const udpTransport = Buffer.from([17, 0, 0, 0]); // 17 = UDP
  const noAuth = Buffer.concat([
    header(ALLOCATE_REQUEST, 8, tid2),
    attr(ATTR_REQUESTED_TRANSPORT, udpTransport),
  ]);
  const denied = await send(noAuth);
  const dAttrs = parseAttrs(denied);
  const errCode = dAttrs.get(ATTR_ERROR_CODE);
  const code = errCode ? errCode[2] * 100 + errCode[3] : 0;
  check('бе учётка → 401 (relay ба ҳар кас дода намешавад)', denied.readUInt16BE(0) === ALLOCATE_ERROR && code === 401, `type=0x${denied.readUInt16BE(0).toString(16)} code=${code}`);

  const realmBuf = dAttrs.get(ATTR_REALM);
  const nonceBuf = dAttrs.get(ATTR_NONCE);
  check('realm ва nonce дода мешаванд (lt-cred-mech фаъол)', !!realmBuf && !!nonceBuf, `realm=${realmBuf?.toString()}`);
  if (!realmBuf || !nonceBuf) throw new Error('realm/nonce нест — coturn бе lt-cred-mech аст');
  const realm = realmBuf.toString();
  console.log(`    realm: ${realm}`);

  // ── 3. ГЛАВНОЕ: бо учёткаи мо relay дода мешавад?
  const tid3 = randomBytes(12);
  const authAttrs = Buffer.concat([
    attr(ATTR_REQUESTED_TRANSPORT, udpTransport),
    attr(ATTR_USERNAME, Buffer.from(USER)),
    attr(ATTR_REALM, realmBuf),
    attr(ATTR_NONCE, nonceBuf),
  ]);
  const allocated = await send(withIntegrity(ALLOCATE_REQUEST, tid3, authAttrs, realm));
  const aAttrs = parseAttrs(allocated);
  const ok = allocated.readUInt16BE(0) === ALLOCATE_SUCCESS;
  const aErr = aAttrs.get(ATTR_ERROR_CODE);
  check(
    'бо логин/пароли мо TURN relay ҶУДО КАРД',
    ok,
    aErr ? `хато ${aErr[2] * 100 + aErr[3]}: ${aErr.subarray(4).toString()}` : `type=0x${allocated.readUInt16BE(0).toString(16)}`,
  );
  const relay = aAttrs.get(ATTR_XOR_RELAYED_ADDRESS);
  check('суроғаи relay дода шуд', !!relay, relay ? xorAddress(relay) : 'нест');
  if (relay) console.log(`    relay: ${xorAddress(relay)}`);

  // Разговор с TURN закончен — закрываем сокет ЗДЕСЬ, а не в конце.
  // Живой UDP-дескриптор в момент выхода из ts-node роняет на Windows ассерт
  // libuv (UV_HANDLE_CLOSING), и процесс отдаёт ненулевой код — verify:all
  // считал бы пройденную проверку упавшей.
  await new Promise<void>((resolve) => sock.close(() => resolve()));

  // ── 4. API ҳамон учёткаро ба фронт медиҳад?
  const me = await req('POST', '/auth/login', { login: 'eraj', password: 'Password123' });
  const token: string | undefined = me.json?.data?.accessToken;
  if (token) {
    const ice = await req('GET', '/chats/calls/ice-servers', undefined, token);
    const data = ice.json?.data;
    check('API hasTurn=true медиҳад', data?.hasTurn === true, JSON.stringify(data));
    const turn = (data?.iceServers ?? []).find((s: { urls: string[] }) =>
      s.urls.some((u) => u.startsWith('turn:')),
    );
    check('дар ICE turn: бо учётка ҳаст', !!turn?.username && !!turn?.credential, JSON.stringify(turn));
    check('учёткаи API бо учёткаи TURN мехонад', turn?.username === USER, `${turn?.username} vs ${USER}`);
  } else {
    console.log('    (юзери seed нест — қисми API гузаронда шуд)');
  }

  console.log(`\n  Натиҷа: ${passed} гузашт, ${failed} афтод\n`);
  // Без process.exit: выходим кодом и даём циклу событий закрыться самому.
  // process.exit здесь роняет на Windows ассерт libuv (UV_HANDLE_CLOSING) —
  // проверка печатала «9 гузашт, 0 афтод» и при этом отдавала код 127, то есть
  // verify:all видел падение там, где всё прошло.
  process.exitCode = failed ? 1 : 0;
}

main().catch((e: Error) => {
  console.error('💥', e.message);
  process.exitCode = 1;
});
