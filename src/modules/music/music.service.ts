import { Readable } from 'node:stream';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { buildCursorPage, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MusicDto, SaveMusicDto, SearchMusicDto } from './dto/music.dto';

const TRENDING_LIMIT = 20;

const MUSIC_SELECT = {
  id: true,
  title: true,
  artist: true,
  url: true,
  coverUrl: true,
  duration: true,
  genre: true,
  isTrending: true,
  usesCount: true,
} satisfies Prisma.MusicSelect;

type MusicRow = Prisma.MusicGetPayload<{ select: typeof MUSIC_SELECT }>;

/** Кусок трека для Range-ответа. */
export interface AudioChunk {
  stream: Readable;
  mime: string;
  /** Размер всего файла. */
  totalSize: number;
  /** Сколько байт отдаём сейчас. */
  contentLength: number;
  /** null → клиент просил файл целиком (200), иначе Content-Range (206). */
  range: { start: number; end: number } | null;
}

@Injectable()
export class MusicService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
  }

  // ─────────────── поиск и списки ───────────────

  /** Ищем И по title, И по artist — как в IG, где одно поле поиска на всё. */
  async search(userId: string, dto: SearchMusicDto): Promise<CursorPage<MusicDto>> {
    const q = dto.q?.trim();
    const where: Prisma.MusicWhereInput = {
      ...(dto.genre ? { genre: dto.genre } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { artist: { contains: q, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.music.findMany({
      where,
      select: MUSIC_SELECT,
      orderBy: { id: 'asc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });

    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    const saved = await this.savedIds(userId, page.items);
    return { ...page, items: page.items.map((r) => this.toDto(r, saved)) };
  }

  async trending(userId: string): Promise<MusicDto[]> {
    // Сначала отмеченные как trending, дальше — по числу использований.
    const rows = await this.prisma.music.findMany({
      where: { isTrending: true },
      select: MUSIC_SELECT,
      orderBy: [{ usesCount: 'desc' }, { id: 'asc' }],
      take: TRENDING_LIMIT,
    });

    const saved = await this.savedIds(userId, rows);
    return rows.map((r) => this.toDto(r, saved));
  }

  async byId(userId: string, id: number): Promise<MusicDto> {
    const row = await this.prisma.music.findUnique({ where: { id }, select: MUSIC_SELECT });
    if (!row) throw new NotFoundException('Трек не найден');

    const saved = await this.savedIds(userId, [row]);
    return this.toDto(row, saved);
  }

  // ─────────────── сохранение ───────────────

  async save(userId: string, musicId: number): Promise<SaveMusicDto> {
    await this.assertExists(musicId);
    // Идемпотентно: повторное сохранение — не ошибка (@@unique userId+musicId).
    await this.prisma.savedMusic.upsert({
      where: { userId_musicId: { userId, musicId } },
      create: { userId, musicId },
      update: {},
    });
    return { saved: true, message: 'Трек сохранён' };
  }

  async unsave(userId: string, musicId: number): Promise<SaveMusicDto> {
    await this.assertExists(musicId);
    await this.prisma.savedMusic.deleteMany({ where: { userId, musicId } });
    return { saved: false, message: 'Трек убран из сохранённых' };
  }

  // ─────────────── стриминг ───────────────

  /**
   * Отдаёт трек целиком (200) или кусок (206) — в зависимости от заголовка Range.
   * Плеер в браузере ВСЕГДА шлёт Range: без 206 перемотка не работает,
   * а Safari вообще откажется играть.
   */
  async stream(id: number, rangeHeader?: string): Promise<AudioChunk> {
    const music = await this.prisma.music.findUnique({
      where: { id },
      select: { url: true },
    });
    if (!music) throw new NotFoundException('Трек не найден');

    const key = this.storage.keyFromUrl(music.url);
    if (!key) {
      // URL не из нашего S3 (например, оставшаяся заглушка из старого seed).
      throw new NotFoundException('Файл трека не лежит в нашем хранилище');
    }

    const { size, mime } = await this.storage.stat(key);
    const range = this.parseRange(rangeHeader, size);

    if (!range) {
      return {
        stream: await this.storage.getStream(key),
        mime,
        totalSize: size,
        contentLength: size,
        range: null,
      };
    }

    const contentLength = range.end - range.start + 1;
    return {
      stream: await this.storage.getPartialStream(key, range.start, contentLength),
      mime,
      totalSize: size,
      contentLength,
      range,
    };
  }

  /**
   * `Range: bytes=0-1023` · `bytes=1024-` · `bytes=-500` (последние 500 байт).
   * Некорректный или неподдерживаемый заголовок → null, отдаём файл целиком (200):
   * так спецификация HTTP и предписывает вести себя при неразбираемом Range.
   */
  private parseRange(
    header: string | undefined,
    size: number,
  ): { start: number; end: number } | null {
    if (!header) return null;

    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null;

    const [, rawStart, rawEnd] = match;
    let start: number;
    let end: number;

    if (rawStart === '') {
      if (rawEnd === '') return null;
      // bytes=-500 → последние 500 байт.
      const suffix = Number(rawEnd);
      if (suffix <= 0) return null;
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(rawStart);
      end = rawEnd === '' ? size - 1 : Number(rawEnd);
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
    return { start, end: Math.min(end, size - 1) };
  }

  // ─────────────── helpers ───────────────

  private async assertExists(id: number): Promise<void> {
    const music = await this.prisma.music.findUnique({ where: { id }, select: { id: true } });
    if (!music) throw new NotFoundException('Трек не найден');
  }

  /** Одним запросом на всю страницу — без N+1. */
  private async savedIds(userId: string, rows: { id: number }[]): Promise<Set<number>> {
    if (rows.length === 0) return new Set();
    const saved = await this.prisma.savedMusic.findMany({
      where: { userId, musicId: { in: rows.map((r) => r.id) } },
      select: { musicId: true },
    });
    return new Set(saved.map((s) => s.musicId));
  }

  private toDto(row: MusicRow, saved: Set<number>): MusicDto {
    // Есть ли у нас сам файл. `keyFromUrl` возвращает ключ, только если url
    // указывает в наш S3 — это тот же вопрос, что задаёт /music/:id/stream перед
    // отдачей, поэтому ответ не может разойтись с реальностью.
    const isFullTrack = this.storage.keyFromUrl(row.url) !== null;
    return {
      id: row.id,
      title: row.title,
      artist: row.artist,
      // Клиенту отдаём НАШ streaming-endpoint, а не прямую ссылку в S3:
      // так работает Range, и мы сможем считать прослушивания.
      //
      // Но только когда файл действительно наш: у трека из внешнего каталога
      // (Deezer/Spotify) полного mp3 нет, и ссылка на стриминг вела бы в 404 —
      // клиент нажал бы play и получил тишину. Ему отдаём превью и честный флаг.
      streamUrl: isFullTrack ? `${this.appUrl}/api/music/${row.id}/stream` : null,
      previewUrl: isFullTrack ? null : row.url,
      isFullTrack,
      coverUrl: row.coverUrl,
      duration: row.duration,
      genre: row.genre,
      isTrending: row.isTrending,
      usesCount: row.usesCount,
      isSaved: saved.has(row.id),
    };
  }
}
