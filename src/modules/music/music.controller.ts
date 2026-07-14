import {
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CursorPage } from '../../common/pagination/cursor.dto';
import { MusicDto, SaveMusicDto, SearchMusicDto } from './dto/music.dto';
import { MusicService } from './music.service';

@ApiBearerAuth()
@ApiTags('music')
@Controller('music')
export class MusicController {
  constructor(private readonly musicService: MusicService) {}

  @Get()
  @ApiOperation({ summary: 'Поиск музыки (по title И artist, курсорная пагинация)' })
  @ApiOkResponse({ type: [MusicDto] })
  async search(
    @CurrentUser('id') userId: string,
    @Query() dto: SearchMusicDto,
  ): Promise<CursorPage<MusicDto>> {
    return this.musicService.search(userId, dto);
  }

  @Get('trending')
  @ApiOperation({ summary: 'В тренде' })
  @ApiOkResponse({ type: [MusicDto] })
  async trending(@CurrentUser('id') userId: string): Promise<MusicDto[]> {
    return this.musicService.trending(userId);
  }

  /**
   * Стриминг — ДО ':id', иначе 'stream' не попадёт сюда.
   * @Public: <audio src="..."> в браузере не умеет слать Authorization-заголовок.
   * Прямые ссылки на объекты в MinIO и так публичные, так что ничего нового не открываем.
   */
  @Public()
  @Get(':id/stream')
  @Header('Accept-Ranges', 'bytes')
  @ApiOperation({
    summary: 'Стриминг mp3 с поддержкой Range (перемотка)',
    description:
      'Без Range → 200 и весь файл. С Range → 206 Partial Content + Content-Range. ' +
      'Плеер в браузере всегда шлёт Range — без 206 перемотка не работает.',
  })
  @ApiParam({ name: 'id', example: 1 })
  @ApiHeader({ name: 'Range', required: false, example: 'bytes=0-1023' })
  @ApiResponse({ status: 200, description: 'Весь файл' })
  @ApiResponse({ status: 206, description: 'Partial Content — кусок файла' })
  @ApiResponse({ status: 404, description: 'Трек не найден' })
  async stream(
    @Param('id', ParseIntPipe) id: number,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const chunk = await this.musicService.stream(id, rangeHeader);

    res.setHeader('Content-Type', chunk.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', chunk.contentLength);

    if (chunk.range) {
      res.setHeader(
        'Content-Range',
        `bytes ${chunk.range.start}-${chunk.range.end}/${chunk.totalSize}`,
      );
      res.status(HttpStatus.PARTIAL_CONTENT);
    } else {
      res.status(HttpStatus.OK);
    }

    // Пишем поток напрямую в ответ: файл в память не поднимаем.
    chunk.stream.pipe(res);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Трек по id' })
  @ApiOkResponse({ type: MusicDto })
  async byId(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MusicDto> {
    return this.musicService.byId(userId, id);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Сохранить трек (идемпотентно)' })
  @ApiOkResponse({ type: SaveMusicDto })
  async save(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SaveMusicDto> {
    return this.musicService.save(userId, id);
  }

  @Delete(':id/save')
  @ApiOperation({ summary: 'Убрать трек из сохранённых' })
  @ApiOkResponse({ type: SaveMusicDto })
  async unsave(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SaveMusicDto> {
    return this.musicService.unsave(userId, id);
  }
}
