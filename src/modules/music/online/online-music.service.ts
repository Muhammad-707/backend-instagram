import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MusicProvider } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { DeezerService } from './deezer.service';
import { OnlineMusicProvider, OnlineTrack } from './online-track';
import { SpotifyService } from './spotify.service';

/**
 * «Найти любую песню мира» — одна дверь поверх внешних каталогов.
 *
 * Почему не просто Spotify: его `/search` отвечает `403 Active premium
 * subscription required for the owner of the app`. Это ограничение аккаунта
 * владельца приложения, а не нашего кода — но пользователю от этого не легче:
 * поиск музыки не работает вовсе. Поэтому источник сделан сменным, а Deezer
 * (без ключей и без подписки) — рабочим по умолчанию.
 *
 * Порядок: сначала провайдер из `MUSIC_PROVIDER` (если задан и настроен), иначе
 * первый готовый из списка. Если он на запросе падает — переходим к следующему:
 * поиск музыки не должен ломаться из-за чужого каталога.
 *
 * Полного трека не даёт НИ ОДИН внешний каталог — максимум 30-сек превью.
 * Трек играет целиком, только если его mp3 лежит у нас (см. `music:import`).
 */
@Injectable()
export class OnlineMusicService {
  private readonly logger = new Logger(OnlineMusicService.name);
  private readonly providers: OnlineMusicProvider[];

  constructor(
    private readonly prisma: PrismaService,
    deezer: DeezerService,
    spotify: SpotifyService,
  ) {
    // Порядок = приоритет. Deezer первый: работает без учёток и подписок.
    // Spotify — запасной: он отвечает 403, пока у владельца приложения нет
    // Premium, и включится сам, когда это перестанет быть так.
    this.providers = [deezer, spotify];
  }

  /** Какие каталоги реально доступны — это же видит фронт в /music/online/providers. */
  available(): MusicProvider[] {
    return this.providers.filter((p) => p.isConfigured()).map((p) => p.provider);
  }

  /**
   * Поиск по каталогам. Первый работающий провайдер отвечает; если он упал —
   * пробуем следующий, и только когда закончились все — отдаём ошибку.
   */
  async search(query: string, limit: number): Promise<OnlineTrack[]> {
    const ready = this.providers.filter((p) => p.isConfigured());
    if (ready.length === 0) throw new NotFoundException('Ни один каталог музыки не настроен');

    let lastError: unknown;
    for (const provider of ready) {
      try {
        return await provider.search(query, limit);
      } catch (e) {
        lastError = e;
        this.logger.warn(`${provider.provider} не ответил на поиск, пробуем следующий каталог`);
      }
    }
    throw lastError;
  }

  /** Поиск в КОНКРЕТНОМ каталоге, без фолбэка — для `/spotify/search` и `?provider=`. */
  async searchIn(provider: MusicProvider, query: string, limit: number): Promise<OnlineTrack[]> {
    const impl = this.providers.find((p) => p.provider === provider);
    if (!impl || !impl.isConfigured()) {
      throw new NotFoundException(`Каталог ${provider} недоступен`);
    }
    return impl.search(query, limit);
  }

  /** Наш Music.id уже импортированного трека — 404, если его не импортировали. */
  async findImported(provider: MusicProvider, externalId: string): Promise<number> {
    const row = await this.prisma.music.findUnique({
      where: { provider_externalId: { provider, externalId } },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Этот трек ещё не был сохранён');
    return row.id;
  }

  /**
   * Затащить трек из каталога в нашу таблицу Music и вернуть его id.
   *
   * Идемпотентно по паре (provider, externalId): повторная отправка того же
   * трека не плодит строки. В «сохранённые» НЕ добавляет — поделиться треком и
   * сохранить его себе это разные намерения.
   */
  async ensureImported(provider: MusicProvider, externalId: string): Promise<number> {
    const impl = this.providers.find((p) => p.provider === provider);
    if (!impl || !impl.isConfigured()) {
      throw new NotFoundException(`Каталог ${provider} недоступен`);
    }
    const track = await impl.getTrack(externalId);
    return this.importTrack(track);
  }

  async importTrack(track: OnlineTrack): Promise<number> {
    const fields = {
      title: track.title,
      artist: track.artist,
      // Полного mp3 у внешнего каталога нет: храним превью, а если и его нет —
      // ссылку на страницу трека. `isFullTrack` считается по наличию файла в
      // нашем S3, так что превью честно покажется как превью.
      url: track.previewUrl ?? track.pageUrl,
      coverUrl: track.coverUrl,
      duration: track.duration,
    };
    const row = await this.prisma.music.upsert({
      where: { provider_externalId: { provider: track.provider, externalId: track.externalId } },
      create: { provider: track.provider, externalId: track.externalId, ...fields },
      update: fields,
      select: { id: true },
    });
    return row.id;
  }

  /** Какие из найденных треков уже есть у нас — чтобы поиск не ходил в БД по одному. */
  async savedMap(
    userId: string,
    tracks: OnlineTrack[],
  ): Promise<Map<string, { musicId: number; isSaved: boolean }>> {
    if (tracks.length === 0) return new Map();

    const rows = await this.prisma.music.findMany({
      where: {
        OR: tracks.map((t) => ({ provider: t.provider, externalId: t.externalId })),
      },
      select: {
        id: true,
        provider: true,
        externalId: true,
        savedBy: { where: { userId }, select: { userId: true } },
      },
    });

    const map = new Map<string, { musicId: number; isSaved: boolean }>();
    for (const r of rows) {
      if (!r.provider || !r.externalId) continue;
      map.set(`${r.provider}:${r.externalId}`, {
        musicId: r.id,
        isSaved: r.savedBy.length > 0,
      });
    }
    return map;
  }
}
