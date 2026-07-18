import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MusicProvider } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MusicDto, SaveMusicDto } from '../music/dto/music.dto';
import { MusicService } from '../music/music.service';
import { OnlineMusicService } from '../music/online/online-music.service';
import { SearchSpotifyDto, SpotifyTrackDto } from './dto/spotify.dto';

/**
 * Spotify-специфичные роуты. Оставлены ради обратной совместимости, но вся
 * работа делегируется общему `OnlineMusicService`: каталог у нас теперь сменный.
 *
 * Поиск (`GET /spotify/search`) НЕ привязан к одному Spotify: он идёт через
 * общий `OnlineMusicService.search()`, который берёт первый рабочий каталог
 * (сейчас Deezer) и переключается на Spotify сам, как только у владельца
 * приложения появится Premium и уйдёт `403 Active premium subscription
 * required`. Так фронт, который зовёт /spotify/search, показывает музыку всегда.
 *
 * Чтобы save/unsave работали с любым каталогом, `spotifyId` в ответе — это
 * составной id `PROVIDER:externalId` (например `DEEZER:3135556`). Фронт хранит
 * его как непрозрачную строку и шлёт обратно; здесь мы разбираем провайдера,
 * так что импорт идёт в правильный каталог. Голый id без префикса трактуется
 * как Spotify — обратная совместимость со старыми клиентами.
 */
@ApiBearerAuth()
@ApiTags('spotify')
@Controller('spotify')
export class SpotifyController {
  constructor(
    private readonly online: OnlineMusicService,
    private readonly music: MusicService,
  ) {}

  /** `PROVIDER:externalId` → отдаём фронту как непрозрачный `spotifyId`. */
  private encodeId(provider: MusicProvider, externalId: string): string {
    return `${provider}:${externalId}`;
  }

  /** Разбор `spotifyId` обратно. Без префикса — легаси-Spotify id. */
  private decodeId(id: string): { provider: MusicProvider; externalId: string } {
    const idx = id.indexOf(':');
    if (idx > 0) {
      const prefix = id.slice(0, idx).toUpperCase();
      if (prefix === MusicProvider.SPOTIFY || prefix === MusicProvider.DEEZER) {
        return { provider: prefix, externalId: id.slice(idx + 1) };
      }
    }
    return { provider: MusicProvider.SPOTIFY, externalId: id };
  }

  @Get('search')
  @ApiOperation({
    summary: 'Поиск музыки (Deezer + Spotify)',
    description:
      'Ищет песню в доступном каталоге: сначала Deezer (работает без подписок), ' +
      'Spotify подключается сам, когда у владельца приложения появится Premium. ' +
      'Поле spotifyId — составной id (PROVIDER:externalId), шлите его в save/unsave как есть.',
  })
  @ApiOkResponse({ type: [SpotifyTrackDto] })
  async search(
    @CurrentUser('id') userId: string,
    @Query() dto: SearchSpotifyDto,
  ): Promise<SpotifyTrackDto[]> {
    const tracks = await this.online.search(dto.q, dto.limit);
    const saved = await this.online.savedMap(userId, tracks);
    return tracks.map((t) => ({
      spotifyId: this.encodeId(t.provider, t.externalId),
      title: t.title,
      artist: t.artist,
      albumCover: t.coverUrl || null,
      previewUrl: t.previewUrl,
      spotifyUrl: t.pageUrl,
      durationSec: t.duration,
      isSaved: saved.get(`${t.provider}:${t.externalId}`)?.isSaved ?? false,
    }));
  }

  @Post('tracks/:spotifyId/save')
  @ApiOperation({
    summary: 'Сохранить трек из Spotify',
    description:
      'Импортирует трек в вашу музыку (дедуп по provider+externalId) и помечает сохранённым. ' +
      'Дальше он доступен как обычный трек: в /profile/me/saved-music, в постах и историях.',
  })
  @ApiCreatedResponse({ type: MusicDto })
  async save(
    @CurrentUser('id') userId: string,
    @Param('spotifyId') spotifyId: string,
  ): Promise<MusicDto> {
    const { provider, externalId } = this.decodeId(spotifyId);
    const musicId = await this.online.ensureImported(provider, externalId);
    await this.music.save(userId, musicId);
    return this.music.byId(userId, musicId);
  }

  @Delete('tracks/:spotifyId/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Убрать трек из сохранённых' })
  @ApiOkResponse({ type: SaveMusicDto })
  async unsave(
    @CurrentUser('id') userId: string,
    @Param('spotifyId') spotifyId: string,
  ): Promise<SaveMusicDto> {
    const { provider, externalId } = this.decodeId(spotifyId);
    const musicId = await this.online.findImported(provider, externalId);
    return this.music.unsave(userId, musicId);
  }
}
