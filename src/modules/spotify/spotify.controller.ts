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
 * Для поиска музыки в приложении используйте `GET /music/online` — он ищет в
 * доступном каталоге (сейчас Deezer). Этот роут жёстко привязан к Spotify и
 * будет отвечать 503, пока `/search` Spotify возвращает
 * `403 Active premium subscription required for the owner of the app` —
 * это ограничение аккаунта владельца приложения, кодом не обходится.
 */
@ApiBearerAuth()
@ApiTags('spotify')
@Controller('spotify')
export class SpotifyController {
  constructor(
    private readonly online: OnlineMusicService,
    private readonly music: MusicService,
  ) {}

  @Get('search')
  @ApiOperation({
    summary: 'Поиск треков в Spotify (устарел — см. GET /music/online)',
    description:
      'Ищет ТОЛЬКО в Spotify. Пока у владельца Spotify-приложения нет Premium, отвечает 503. ' +
      'Для поиска любой песни мира используйте /music/online — он работает без подписок.',
  })
  @ApiOkResponse({ type: [SpotifyTrackDto] })
  async search(
    @CurrentUser('id') userId: string,
    @Query() dto: SearchSpotifyDto,
  ): Promise<SpotifyTrackDto[]> {
    const tracks = await this.online.searchIn(MusicProvider.SPOTIFY, dto.q, dto.limit);
    const saved = await this.online.savedMap(userId, tracks);
    return tracks.map((t) => ({
      spotifyId: t.externalId,
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
    const musicId = await this.online.ensureImported(MusicProvider.SPOTIFY, spotifyId);
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
    const musicId = await this.online.findImported(MusicProvider.SPOTIFY, spotifyId);
    return this.music.unsave(userId, musicId);
  }
}
