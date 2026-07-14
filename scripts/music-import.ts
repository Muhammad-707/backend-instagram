/**
 * npm run music:import
 *
 * Кладёте mp3 в assets/music/ → скрипт сам:
 *   1. читает ID3-теги и длительность через ffprobe,
 *   2. заливает mp3 и обложку в MinIO,
 *   3. пишет/обновляет строку в таблице Music (upsert по title+artist — повторный запуск не плодит дубли).
 *
 * Обложка берётся так:
 *   - assets/music/<имя файла>.jpg|png, если положили рядом;
 *   - иначе встроенная в mp3 обложка (ID3 APIC), если она есть;
 *   - иначе картинка-заглушка с picsum.photos (детерминированная по имени трека).
 *
 * Когда появятся 34 mp3 с Pixabay — просто положить их в assets/music/ и запустить скрипт.
 * Код при этом не трогается.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { Client as MinioClient } from 'minio';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();

const MUSIC_DIR = join(process.cwd(), 'assets', 'music');
const BUCKET = process.env.S3_BUCKET ?? 'instagram';
const PUBLIC_URL = (process.env.S3_PUBLIC_URL ?? 'http://localhost:9000/instagram').replace(
  /\/+$/,
  '',
);
const COVER_SIZE = 640;
/** Треки с 10 и более использованиями считаем трендовыми (пересчёт — cron в Фазе 12). */
const TRENDING_MIN_USES = 10;

const minio = new MinioClient({
  endPoint: process.env.S3_ENDPOINT ?? 'localhost',
  port: Number(process.env.S3_PORT ?? '9000'),
  useSSL: process.env.S3_USE_SSL === 'true',
  accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
  secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
});

interface Probe {
  duration: number;
  title?: string;
  artist?: string;
  genre?: string;
  hasEmbeddedCover: boolean;
}

interface FfprobeTags {
  title?: string;
  artist?: string;
  album_artist?: string;
  genre?: string;
}

interface FfprobeOutput {
  format?: { duration?: string; tags?: FfprobeTags };
  streams?: { codec_type?: string; codec_name?: string; disposition?: { attached_pic?: number } }[];
}

async function probe(file: string): Promise<Probe> {
  const { stdout } = await execFileAsync(ffprobeStatic.path, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  const data = JSON.parse(stdout) as FfprobeOutput;
  const tags = data.format?.tags ?? {};

  return {
    duration: Math.round(Number(data.format?.duration ?? 0)),
    title: tags.title,
    artist: tags.artist ?? tags.album_artist,
    genre: tags.genre,
    hasEmbeddedCover: (data.streams ?? []).some((s) => s.disposition?.attached_pic === 1),
  };
}

/** Обложка, вшитая в mp3 (ID3 APIC) — вытаскиваем ffmpeg'ом. */
async function extractEmbeddedCover(file: string): Promise<Buffer | null> {
  if (!ffmpegPath) return null;
  const out = join(MUSIC_DIR, `.cover-${createHash('md5').update(file).digest('hex')}.jpg`);
  try {
    await execFileAsync(ffmpegPath, ['-y', '-v', 'quiet', '-i', file, '-an', '-vcodec', 'copy', out]);
    const buf = await fs.readFile(out);
    return buf;
  } catch {
    return null;
  } finally {
    await fs.rm(out, { force: true });
  }
}

/** Заглушка-обложка: детерминированная по имени, чтобы у трека всегда была одна и та же картинка. */
async function fallbackCover(seed: string): Promise<Buffer> {
  const id = (parseInt(createHash('md5').update(seed).digest('hex').slice(0, 6), 16) % 900) + 100;
  const res = await fetch(`https://picsum.photos/seed/${id}/${COVER_SIZE}/${COVER_SIZE}`);
  if (!res.ok) throw new Error(`picsum: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function upload(key: string, body: Buffer, mime: string): Promise<string> {
  await minio.putObject(BUCKET, key, body, body.length, {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  return `${PUBLIC_URL}/${key}`;
}

/** «SoundHelix-Song-1» → «Soundhelix Song 1»: из имени файла, если ID3-тегов нет. */
function titleFromFileName(file: string): string {
  const raw = basename(file, extname(file)).replace(/[-_]+/g, ' ').trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

async function main(): Promise<void> {
  const files = (await fs.readdir(MUSIC_DIR).catch(() => []))
    .filter((f) => f.toLowerCase().endsWith('.mp3'))
    .sort();

  if (files.length === 0) {
    console.log(`Нет mp3 в ${MUSIC_DIR}. Положите файлы и запустите снова.`);
    return;
  }

  if (!(await minio.bucketExists(BUCKET))) {
    await minio.makeBucket(BUCKET, 'us-east-1');
  }

  console.log(`🎵 Импорт ${files.length} треков из assets/music/\n`);
  let created = 0;
  let updated = 0;

  for (const fileName of files) {
    const path = join(MUSIC_DIR, fileName);
    const meta = await probe(path);

    const title = meta.title?.trim() || titleFromFileName(fileName);
    const artist = meta.artist?.trim() || 'Unknown Artist';

    // ── обложка ──
    const base = basename(fileName, extname(fileName));
    let coverRaw: Buffer | null = null;
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      coverRaw = await fs.readFile(join(MUSIC_DIR, base + ext)).catch(() => null);
      if (coverRaw) break;
    }
    if (!coverRaw && meta.hasEmbeddedCover) coverRaw = await extractEmbeddedCover(path);
    if (!coverRaw) coverRaw = await fallbackCover(fileName);

    const coverWebp = await sharp(coverRaw)
      .resize(COVER_SIZE, COVER_SIZE, { fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer();

    // ── заливка ──
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const audioUrl = await upload(`music/${slug}.mp3`, await fs.readFile(path), 'audio/mpeg');
    const coverUrl = await upload(`music/covers/${slug}.webp`, coverWebp, 'image/webp');

    // ── БД (upsert по паре title+artist: @@unique в схеме нет, поэтому ищем вручную) ──
    const existing = await prisma.music.findFirst({
      where: { title, artist },
      select: { id: true, usesCount: true },
    });

    if (existing) {
      await prisma.music.update({
        where: { id: existing.id },
        data: {
          url: audioUrl,
          coverUrl,
          duration: meta.duration,
          genre: meta.genre ?? null,
          isTrending: existing.usesCount >= TRENDING_MIN_USES,
        },
      });
      updated++;
      console.log(`  ↻ ${title} — ${artist} (${meta.duration}с)`);
    } else {
      await prisma.music.create({
        data: {
          title,
          artist,
          url: audioUrl,
          coverUrl,
          duration: meta.duration,
          genre: meta.genre ?? null,
        },
      });
      created++;
      console.log(`  + ${title} — ${artist} (${meta.duration}с)`);
    }
  }

  console.log(`\n✅ Готово: создано ${created}, обновлено ${updated}`);
}

main()
  .catch((e: unknown) => {
    console.error('❌ Импорт упал:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
