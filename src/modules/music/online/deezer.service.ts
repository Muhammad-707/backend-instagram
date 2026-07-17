import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MusicProvider } from '@prisma/client';
import { OnlineMusicProvider, OnlineTrack } from './online-track';

/**
 * Deezer — каталог, который работает без учётной записи вообще.
 *
 * Зачем он, когда есть Spotify: у Spotify `/search` отвечает `403 Active premium
 * subscription required for the owner of the app` — то есть поиск музыки в
 * приложении зависит от подписки владельца Spotify-приложения, а не от нашего
 * кода. Пока её нет, «найти любую песню мира» не работает вовсе. Deezer отдаёт
 * тот же набор (название, исполнитель, обложка, 30-сек превью) без ключей и
 * ограничений по подписке, поэтому он и стал рабочим источником по умолчанию.
 *
 * Превью — mp3, и его можно проиграть напрямую. Полного трека Deezer, как и
 * Spotify, не отдаёт: 30 секунд — это потолок любого внешнего каталога.
 */

interface DeezerArtist {
  name: string;
}
interface DeezerAlbum {
  cover_big?: string;
  cover_medium?: string;
  cover?: string;
}
interface DeezerTrack {
  id: number;
  title: string;
  link: string;
  duration: number;
  preview: string | null;
  artist: DeezerArtist;
  album: DeezerAlbum;
}
interface DeezerSearchResponse {
  data?: DeezerTrack[];
  error?: { message?: string };
}

const API_BASE = 'https://api.deezer.com';
const TIMEOUT_MS = 8000;

@Injectable()
export class DeezerService implements OnlineMusicProvider {
  readonly provider = MusicProvider.DEEZER;
  private readonly logger = new Logger(DeezerService.name);

  /** Ключей не требует — доступен всегда. */
  isConfigured(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<OnlineTrack[]> {
    const url = `${API_BASE}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const json = await this.get<DeezerSearchResponse>(url);
    if (json.error?.message) {
      this.logger.error(`Deezer search: ${json.error.message}`);
      throw new ServiceUnavailableException('Каталог музыки недоступен, попробуйте позже');
    }
    return (json.data ?? []).map((t) => this.toTrack(t));
  }

  async getTrack(externalId: string): Promise<OnlineTrack> {
    const json = await this.get<DeezerTrack & { error?: { message?: string } }>(
      `${API_BASE}/track/${encodeURIComponent(externalId)}`,
    );
    // Deezer на несуществующий трек отвечает 200 с телом {error:{...}}, а не 404.
    if (json.error || !json.id) throw new NotFoundException('Трек не найден');
    return this.toTrack(json);
  }

  private async get<T>(url: string): Promise<T> {
    // Без таймаута зависший каталог держал бы наш запрос до победного.
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((e: Error) => {
      this.logger.error(`Deezer недоступен: ${e.message}`);
      throw new ServiceUnavailableException('Каталог музыки недоступен, попробуйте позже');
    });
    if (!res.ok) {
      this.logger.error(`Deezer ${res.status}: ${await res.text()}`);
      throw new ServiceUnavailableException('Каталог музыки недоступен, попробуйте позже');
    }
    return (await res.json()) as T;
  }

  private toTrack(t: DeezerTrack): OnlineTrack {
    return {
      provider: MusicProvider.DEEZER,
      externalId: String(t.id),
      title: t.title,
      artist: t.artist?.name ?? 'Unknown',
      coverUrl: t.album?.cover_big ?? t.album?.cover_medium ?? t.album?.cover ?? '',
      duration: t.duration,
      previewUrl: t.preview ?? null,
      pageUrl: t.link,
    };
  }
}
