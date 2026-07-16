/**
 * Живая проверка LiveKit (задача 4): что за токен, какие grants, есть ли комната.
 * Запуск: npx ts-node -r dotenv/config scripts/livekit-check.ts
 */
import { RoomServiceClient } from 'livekit-server-sdk';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4000/api';
const WS = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
const KEY = process.env.LIVEKIT_API_KEY ?? 'devkey';
const SECRET = process.env.LIVEKIT_API_SECRET ?? 'devsecret';

const decode = (jwt: string): any =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

async function api(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return (await res.json()).data;
}

async function main(): Promise<void> {
  const rooms = new RoomServiceClient(WS.replace(/^ws/, 'http'), KEY, SECRET);
  const uniq = Date.now().toString().slice(-8);

  const mk = (n: string) => ({
    userName: `lk_${n}_${uniq}`,
    fullName: `LK ${n}`,
    email: `lk_${n}_${uniq}@example.com`,
    password: 'Passw0rd!23',
    confirmPassword: 'Passw0rd!23',
    dob: '2000-01-01',
  });
  const host = await api('POST', '/auth/register', mk('host'));
  const viewer = await api('POST', '/auth/register', mk('view'));

  console.log(`\n▶ LiveKit: ${WS}\n`);

  // ── хост стартует эфир ────────────────────────────────────────────────
  const started = await api('POST', '/live/start', { title: 'LK check' }, host.accessToken);
  const liveId: string = started?.live?.id;
  console.log('wsUrl аз API:      ', started?.wsUrl);

  const hostTok = decode(started.token);
  console.log('\nТокени ХОСТ (decoded):');
  console.log('  iss (apiKey):    ', hostTok.iss);
  console.log('  sub (identity):  ', hostTok.sub);
  console.log('  video grants:    ', JSON.stringify(hostTok.video));

  // ── зритель заходит ───────────────────────────────────────────────────
  const joined = await api('POST', `/live/${liveId}/join`, undefined, viewer.accessToken);
  const viewTok = decode(joined.token);
  console.log('\nТокени ТАМОШОБИН (decoded):');
  console.log('  video grants:    ', JSON.stringify(viewTok.video));

  // ── комната существует? ───────────────────────────────────────────────
  const listBefore = await rooms.listRooms();
  console.log(
    '\nКомнатаҳо дар LiveKit баъди /live/start:',
    listBefore.length ? listBefore.map((r) => r.name).join(', ') : '— ХОЛӢ',
  );

  // ── завершаем ─────────────────────────────────────────────────────────
  await api('POST', `/live/${liveId}/end`, undefined, host.accessToken);
  const listAfter = await rooms.listRooms();
  console.log(
    'Комнатаҳо баъди /live/{id}/end:        ',
    listAfter.length ? listAfter.map((r) => r.name).join(', ') : '— ХОЛӢ',
  );

  console.log('\nХулоса:');
  console.log(`  · хост canPublish:      ${hostTok.video?.canPublish}`);
  console.log(`  · тамошобин canPublish: ${viewTok.video?.canPublish}`);
  console.log(`  · тамошобин canSubscribe: ${viewTok.video?.canSubscribe}`);
  console.log('');
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
