import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MusicDto, SaveMusicDto } from '../music/dto/music.dto';
import { MusicService } from '../music/music.service';
import { SearchSpotifyDto, SpotifyTrackDto } from './dto/spotify.dto';

// ─── Формы ответов Spotify (типизируем, чтобы не тащить any) ───
interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}
interface SpotifyImage {
  url: string;
}
interface SpotifyArtist {
  name: string;
}
interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: { images: SpotifyImage[] };
  preview_url: string | null;
  duration_ms: number;
  external_urls: { spotify: string };
}
interface SpotifySearchResponse {
  tracks: { items: SpotifyTrack[] };
}

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

@Injectable()
export class SpotifyService {
  private readonly logger = new Logger(SpotifyService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;

  // Токен ~1 час. Кэшируем и переиспользуем — на каждый запрос новый не берём.
  private token: { value: string; expiresAt: number } = { value: '', expiresAt: 0 };

  constructor(
    private readonly prisma: PrismaService,
    private readonly music: MusicService,
    config: ConfigService,
  ) {
    this.clientId = config.get<string>('SPOTIFY_CLIENT_ID', '');
    this.clientSecret = config.get<string>('SPOTIFY_CLIENT_SECRET', '');
  }

  // ─────────────── публичные методы ───────────────

  /** Поиск треков в Spotify + флаг isSaved (уже импортирован мной или нет). */
  async search(userId: string, dto: SearchSpotifyDto): Promise<SpotifyTrackDto[]> {
    const token = await this.getAccessToken();
    const url = `${API_BASE}/search?q=${encodeURIComponent(dto.q)}&type=track&limit=${dto.limit}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      this.logger.error(`Spotify search ${res.status}: ${await res.text()}`);
      throw new ServiceUnavailableException('Spotify недоступен, попробуйте позже');
    }

    const data = (await res.json()) as SpotifySearchResponse;
    const tracks = data.tracks.items;

    const savedSpotifyIds = await this.savedSpotifyIds(
      userId,
      tracks.map((t) => t.id),
    );
    return tracks.map((t) => this.toTrackDto(t, savedSpotifyIds));
  }

  /**
   * Сохранить трек: импортируем его в нашу таблицу Music (дедуп по spotifyId),
   * затем ставим отметку «сохранено» текущему пользователю.
   * Возвращаем НАШ MusicDto — с id, streamUrl и isSaved, как у обычного трека.
   */
  async saveTrack(userId: string, spotifyId: string): Promise<MusicDto> {
    const track = await this.getTrack(spotifyId);
    const musicId = await this.importTrack(track);
    await this.music.save(userId, musicId);
    return this.music.byId(userId, musicId);
  }

  /**
   * Затащить трек из Spotify в нашу таблицу Music и вернуть его id —
   * БЕЗ добавления в «сохранённые».
   *
   * Нужен для отправки трека в чат: «поделиться треком» и «сохранить себе» —
   * разные намерения, и отправка не должна засорять чужой список сохранённого.
   * Импорт идемпотентен (upsert по spotifyId), так что повторная отправка того
   * же трека не плодит строки в Music.
   */
  async ensureImported(spotifyId: string): Promise<number> {
    const track = await this.getTrack(spotifyId);
    return this.importTrack(track);
  }

  /** Убрать из сохранённых. Строку в Music не удаляем — она может быть в чьих-то постах. */
  async unsaveTrack(userId: string, spotifyId: string): Promise<SaveMusicDto> {
    const row = await this.prisma.music.findUnique({
      where: { spotifyId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Этот трек ещё не был сохранён');
    return this.music.unsave(userId, row.id);
  }

  // ─────────────── внутреннее ───────────────

  /** Client Credentials Flow: base64(id:secret) → access_token (с кэшем). */
  private async getAccessToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new ServiceUnavailableException(
        'Spotify не настроен: задайте SPOTIFY_CLIENT_ID и SPOTIFY_CLIENT_SECRET в .env',
      );
    }
    if (this.token.value && Date.now() < this.token.expiresAt) {
      return this.token.value;
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      this.logger.error(`Spotify token ${res.status}: ${await res.text()}`);
      throw new ServiceUnavailableException(
        'Не удалось авторизоваться в Spotify (проверьте ключи)',
      );
    }

    const data = (await res.json()) as SpotifyTokenResponse;
    this.token = {
      value: data.access_token,
      // обновляем за 60 с до конца, чтобы не поймать протухший токен в момент запроса
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return this.token.value;
  }

  private async getTrack(spotifyId: string): Promise<SpotifyTrack> {
    const token = await this.getAccessToken();
    const res = await fetch(`${API_BASE}/tracks/${encodeURIComponent(spotifyId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) throw new NotFoundException('Трек в Spotify не найден');
    if (!res.ok) {
      this.logger.error(`Spotify track ${res.status}: ${await res.text()}`);
      throw new ServiceUnavailableException('Spotify недоступен, попробуйте позже');
    }
    return (await res.json()) as SpotifyTrack;
  }

  /** Upsert по spotifyId → возвращает наш Music.id. Метаданные освежаем при повторе. */
  private async importTrack(track: SpotifyTrack): Promise<number> {
    const fields = {
      title: track.name,
      artist: track.artists.map((a) => a.name).join(', '),
      // Полного mp3 у Spotify нет; храним 30-сек preview, а если и его нет — ссылку на Spotify.
      // Стриминг-эндпоинт для таких треков честно ответит 404 (файла в нашем S3 нет).
      url: track.preview_url ?? track.external_urls.spotify,
      coverUrl: track.album.images[0]?.url ?? '',
      duration: Math.round(track.duration_ms / 1000),
    };
    const row = await this.prisma.music.upsert({
      where: { spotifyId: track.id },
      create: { spotifyId: track.id, ...fields },
      update: fields,
      select: { id: true },
    });
    return row.id;
  }

  /** Какие из spotifyId уже сохранены этим пользователем — одним проходом, без N+1. */
  private async savedSpotifyIds(userId: string, spotifyIds: string[]): Promise<Set<string>> {
    if (spotifyIds.length === 0) return new Set();

    const existing = await this.prisma.music.findMany({
      where: { spotifyId: { in: spotifyIds } },
      select: { id: true, spotifyId: true },
    });
    if (existing.length === 0) return new Set();

    const saved = await this.prisma.savedMusic.findMany({
      where: { userId, musicId: { in: existing.map((e) => e.id) } },
      select: { musicId: true },
    });
    const savedMusicIds = new Set(saved.map((s) => s.musicId));

    const result = new Set<string>();
    for (const e of existing) {
      if (e.spotifyId && savedMusicIds.has(e.id)) result.add(e.spotifyId);
    }
    return result;
  }

  private toTrackDto(t: SpotifyTrack, savedSpotifyIds: Set<string>): SpotifyTrackDto {
    return {
      spotifyId: t.id,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      albumCover: t.album.images[0]?.url ?? null,
      previewUrl: t.preview_url,
      spotifyUrl: t.external_urls.spotify,
      durationSec: Math.round(t.duration_ms / 1000),
      isSaved: savedSpotifyIds.has(t.id),
    };
  }
}
