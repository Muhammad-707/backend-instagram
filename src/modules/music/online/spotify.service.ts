import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MusicProvider } from '@prisma/client';
import { OnlineMusicProvider, OnlineTrack } from './online-track';

/**
 * Spotify как один из каталогов — НЕ единственный и не основной.
 *
 * Почему не основной: `/search` отвечает `403 Active premium subscription
 * required for the owner of the app`. Это ограничение аккаунта владельца
 * приложения — код тут ни при чём, Client Credentials-токен выдаётся нормально.
 * Пока у владельца нет Premium, Spotify молча бесполезен, поэтому по умолчанию
 * работает Deezer, а этот провайдер включится сам, как только 403 уйдёт.
 *
 * `isConfigured()` = есть ключи. Живой 403 ключами не лечится — он всплывёт на
 * запросе, и OnlineMusicService перейдёт к следующему каталогу.
 */

interface SpotifyTokenResponse {
  access_token: string;
  expires_in: number;
}
interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album: { images: { url: string }[] };
  preview_url: string | null;
  duration_ms: number;
  external_urls: { spotify: string };
}
interface SpotifySearchResponse {
  tracks: { items: SpotifyTrack[] };
}

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
const TIMEOUT_MS = 8000;

@Injectable()
export class SpotifyService implements OnlineMusicProvider {
  readonly provider = MusicProvider.SPOTIFY;
  private readonly logger = new Logger(SpotifyService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;

  // Токен живёт ~час. Кэшируем: на каждый поиск новый брать незачем.
  private token: { value: string; expiresAt: number } = { value: '', expiresAt: 0 };

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('SPOTIFY_CLIENT_ID', '');
    this.clientSecret = config.get<string>('SPOTIFY_CLIENT_SECRET', '');
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  async search(query: string, limit: number): Promise<OnlineTrack[]> {
    const url = `${API_BASE}/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`;
    const data = await this.get<SpotifySearchResponse>(url);
    return data.tracks.items.map((t) => this.toTrack(t));
  }

  async getTrack(externalId: string): Promise<OnlineTrack> {
    const track = await this.get<SpotifyTrack>(
      `${API_BASE}/tracks/${encodeURIComponent(externalId)}`,
      true,
    );
    return this.toTrack(track);
  }

  private async get<T>(url: string, notFoundOn404 = false): Promise<T> {
    const token = await this.accessToken();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((e: Error) => {
      this.logger.error(`Spotify недоступен: ${e.message}`);
      throw new ServiceUnavailableException('Spotify недоступен, попробуйте позже');
    });

    if (notFoundOn404 && res.status === 404)
      throw new NotFoundException('Трек в Spotify не найден');
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Spotify ${res.status}: ${body}`);
      throw new ServiceUnavailableException('Spotify недоступен, попробуйте позже');
    }
    return (await res.json()) as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token.value && Date.now() < this.token.expiresAt) return this.token.value;
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Spotify не настроен (нет SPOTIFY_CLIENT_ID/SECRET)');
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.error(`Spotify token ${res.status}: ${await res.text()}`);
      throw new ServiceUnavailableException('Spotify недоступен, попробуйте позже');
    }

    const json = (await res.json()) as SpotifyTokenResponse;
    // Минута запаса, чтобы не отправить запрос с только что истёкшим токеном.
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    };
    return this.token.value;
  }

  private toTrack(t: SpotifyTrack): OnlineTrack {
    return {
      provider: MusicProvider.SPOTIFY,
      externalId: t.id,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      coverUrl: t.album.images[0]?.url ?? '',
      duration: Math.round(t.duration_ms / 1000),
      // preview_url часто null: Spotify убрал превью у многих треков.
      previewUrl: t.preview_url,
      pageUrl: t.external_urls.spotify,
    };
  }
}
