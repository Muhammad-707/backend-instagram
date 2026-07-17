import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { MusicDto } from '../dto/music.dto';
import { MusicService } from '../music.service';
import {
  OnlineProvidersDto,
  OnlineTrackDto,
  SaveOnlineTrackDto,
  SearchOnlineMusicDto,
} from './online-music.dto';
import { OnlineMusicService } from './online-music.service';

/**
 * Поиск музыки во внешних каталогах — «найти любую песню мира» для постов,
 * заметок, историй и чата.
 *
 * Отдельно от `/spotify/*` намеренно: каталог сменный. У Spotify `/search`
 * отвечает 403, пока у владельца приложения нет Premium, и завязывать всю
 * музыку в приложении на чужую подписку нельзя. Сейчас работает Deezer —
 * без ключей и без подписки.
 */
@ApiBearerAuth()
@ApiTags('music')
@Controller('music/online')
export class OnlineMusicController {
  constructor(
    private readonly online: OnlineMusicService,
    private readonly music: MusicService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'Какие каталоги музыки сейчас доступны' })
  @ApiOkResponse({ type: OnlineProvidersDto })
  providers(): OnlineProvidersDto {
    return { providers: this.online.available() };
  }

  @Get()
  @ApiOperation({
    summary: 'Поиск любой песни во внешнем каталоге',
    description:
      'Название/исполнитель → название, исполнитель, обложка, длительность и 30-сек превью. ' +
      'Полного трека внешние каталоги не отдают. `musicId` заполнен, если трек уже импортирован.',
  })
  @ApiOkResponse({ type: [OnlineTrackDto] })
  async search(
    @CurrentUser('id') userId: string,
    @Query() dto: SearchOnlineMusicDto,
  ): Promise<OnlineTrackDto[]> {
    const tracks = await this.online.search(dto.q, dto.limit ?? 20);
    const saved = await this.online.savedMap(userId, tracks);
    return tracks.map((t) => {
      const known = saved.get(`${t.provider}:${t.externalId}`);
      return { ...t, musicId: known?.musicId ?? null, isSaved: known?.isSaved ?? false };
    });
  }

  @Post('save')
  @ApiOperation({
    summary: 'Импортировать трек из каталога и сохранить себе',
    description: 'Идемпотентно: повторный импорт того же трека не создаёт дубликат.',
  })
  @ApiOkResponse({ type: MusicDto })
  async save(
    @CurrentUser('id') userId: string,
    @Body() dto: SaveOnlineTrackDto,
  ): Promise<MusicDto> {
    const musicId = await this.online.ensureImported(dto.provider, dto.externalId);
    await this.music.save(userId, musicId);
    return this.music.byId(userId, musicId);
  }
}
