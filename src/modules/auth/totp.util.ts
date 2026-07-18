import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// RFC 6238 (TOTP) поверх RFC 4226 (HOTP) на node:crypto — без сторонних библиотек.
// Секрет хранится в base32 (как ожидают Google Authenticator / Authy).

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SEC = 30;
const DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Некорректный base32-секрет');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Новый секрет — 20 случайных байт в base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI — фронт рисует из него QR для сканирования приложением. */
export function otpauthUri(secret: string, account: string, issuer = 'Instagram'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SEC) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(secretBuf: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  // 8-байтный big-endian счётчик (writeBigUInt64BE — без потерь на больших значениях).
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secretBuf).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Проверка кода с окном ±window шагов (сдвиг часов клиента). */
export function verifyTotp(secret: string, token: string, window = 1): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const secretBuf = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / STEP_SEC);
  for (let w = -window; w <= window; w++) {
    const expected = hotp(secretBuf, counter + w);
    // timingSafeEqual — сравнение без утечки по времени.
    if (expected.length === token.length && timingSafeEqual(Buffer.from(expected), Buffer.from(token))) {
      return true;
    }
  }
  return false;
}

/** Текущий валидный код — нужен только тестам/сидам, не в рантайме. */
export function currentTotp(secret: string): string {
  return hotp(base32Decode(secret), Math.floor(Date.now() / 1000 / STEP_SEC));
}

/** N резервных кодов вида «ab12-cd34». Возвращаем открытый текст + sha256-хэши для хранения. */
export function generateBackupCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = randomInt(0, 0xffffffff).toString(16).padStart(8, '0');
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return { codes, hashes: codes.map(hashBackupCode) };
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}
