import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiCreatedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MusicDto, SaveMusicDto } from '../music/dto/music.dto';
import { SearchSpotifyDto, SpotifyTrackDto } from './dto/spotify.dto';
import { SpotifyService } from './spotify.service';

@ApiBearerAuth()
@ApiTags('spotify')
@Controller('spotify')
export class SpotifyController {
  constructor(private readonly spotify: SpotifyService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Поиск треков в Spotify',
    description: 'Название/исполнитель → название, артист, обложка альбома, превью. + isSaved.',
  })
  @ApiOkResponse({ type: [SpotifyTrackDto] })
  async search(
    @CurrentUser('id') userId: string,
    @Query() dto: SearchSpotifyDto,
  ): Promise<SpotifyTrackDto[]> {
    return this.spotify.search(userId, dto);
  }

  @Post('tracks/:spotifyId/save')
  @ApiOperation({
    summary: 'Сохранить трек из Spotify',
    description:
      'Импортирует трек в вашу музыку (дедуп по spotifyId) и помечает сохранённым. ' +
      'Дальше он доступен как обычный трек: в /profile/me/saved-music, в постах и историях.',
  })
  @ApiCreatedResponse({ type: MusicDto })
  async save(
    @CurrentUser('id') userId: string,
    @Param('spotifyId') spotifyId: string,
  ): Promise<MusicDto> {
    return this.spotify.saveTrack(userId, spotifyId);
  }

  @Delete('tracks/:spotifyId/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Убрать трек из сохранённых' })
  @ApiOkResponse({ type: SaveMusicDto })
  async unsave(
    @CurrentUser('id') userId: string,
    @Param('spotifyId') spotifyId: string,
  ): Promise<SaveMusicDto> {
    return this.spotify.unsaveTrack(userId, spotifyId);
  }
}
