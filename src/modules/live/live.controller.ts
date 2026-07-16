import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import {
  AudioDto,
  CameraDto,
  JoinRequestDto,
  LiveCommentDto,
  LiveCommentInputDto,
  LiveDto,
  LiveLikeResultDto,
  LiveOkDto,
  LiveReactionInputDto,
  LiveRequestsQueryDto,
  LiveStatsDto,
  LiveTokenDto,
  LiveViewerDto,
  StartLiveDto,
} from './dto/live.dto';
import { LiveService } from './live.service';

@ApiBearerAuth()
@ApiTags('live')
@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  @Post('start')
  @ApiOperation({ summary: 'Начать эфир → Live + LiveKit-комната + publisher-токен' })
  @ApiCreatedResponse({ type: LiveTokenDto })
  async start(@CurrentUser('id') userId: string, @Body() dto: StartLiveDto): Promise<LiveTokenDto> {
    return this.live.start(userId, dto);
  }

  @Get('feed')
  @ApiOperation({ summary: 'Активные эфиры подписок (рейл историй)' })
  @ApiOkResponse({ type: LiveDto, isArray: true })
  async feed(@CurrentUser('id') userId: string): Promise<LiveDto[]> {
    return this.live.feed(userId);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Активный эфир пользователя (профиль → «В эфире»)' })
  @ApiOkResponse({ type: LiveDto })
  async userLive(
    @CurrentUser('id') me: string,
    @Param('userId') targetUserId: string,
  ): Promise<LiveDto | null> {
    return this.live.getUserLive(me, targetUserId);
  }

  @Post('requests/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Хост принял заявку → гостю publisher-токен (split-экран)' })
  @ApiOkResponse({ type: LiveOkDto })
  async accept(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) requestId: number,
  ): Promise<LiveOkDto> {
    return this.live.acceptRequest(userId, requestId);
  }

  @Post('requests/:id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Хост отклонил заявку → гостю уведомление отказа' })
  @ApiOkResponse({ type: LiveOkDto })
  async decline(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) requestId: number,
  ): Promise<LiveOkDto> {
    return this.live.declineRequest(userId, requestId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Один эфир' })
  @ApiOkResponse({ type: LiveDto })
  async getOne(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<LiveDto> {
    return this.live.getOne(userId, id);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Завершить эфир (статистика, комната закрывается)' })
  @ApiOkResponse({ type: LiveStatsDto })
  async end(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<LiveStatsDto> {
    return this.live.end(userId, id);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Зайти зрителем → subscriber-токен (Block + Privacy)' })
  @ApiOkResponse({ type: LiveTokenDto })
  async join(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<LiveTokenDto> {
    return this.live.join(userId, id);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Покинуть эфир' })
  @ApiOkResponse({ type: LiveOkDto })
  async leave(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<LiveOkDto> {
    return this.live.leave(userId, id);
  }

  @Get(':id/viewers')
  @ApiOperation({ summary: 'Текущие зрители эфира' })
  @ApiOkResponse({ type: LiveViewerDto, isArray: true })
  async viewers(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<LiveViewerDto[]> {
    return this.live.viewers(userId, id);
  }

  @Get(':id/comments')
  @ApiOperation({
    summary: 'Комментарии эфира (новые → старые)',
    description:
      'Курсор — id последнего элемента предыдущей страницы. Доступ тот же, что у ' +
      '/live/{id}/join: блокировка и приватность действуют одинаково.',
  })
  @ApiOkResponse({ type: LiveCommentDto, isArray: true })
  async comments(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<LiveCommentDto>> {
    return this.live.comments(userId, id, dto);
  }

  @Get(':id/requests')
  @ApiOperation({
    summary: 'Заявки на участие в эфире (только хост)',
    description:
      'id из этого списка принимает POST /live/requests/{id}/accept | /decline. ' +
      'Без status отдаются все заявки.',
  })
  @ApiOkResponse({ type: JoinRequestDto, isArray: true })
  @ApiForbiddenResponse({ description: 'Только хост эфира может это делать' })
  async requests(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query() dto: LiveRequestsQueryDto,
  ): Promise<JoinRequestDto[]> {
    return this.live.requests(userId, id, dto.status);
  }

  @Post(':id/comment')
  @ApiOperation({ summary: 'Комментарий в эфир' })
  @ApiCreatedResponse({ type: LiveCommentDto })
  async comment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: LiveCommentInputDto,
  ): Promise<LiveCommentDto> {
    return this.live.comment(userId, id, dto);
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Лайк эфира (можно много раз — всплывающие сердечки)' })
  @ApiOkResponse({ type: LiveLikeResultDto })
  async like(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<LiveLikeResultDto> {
    return this.live.like(userId, id);
  }

  @Post(':id/reaction')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Реакция-смайл (всплывает у всех)' })
  @ApiOkResponse({ type: LiveOkDto })
  async reaction(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: LiveReactionInputDto,
  ): Promise<LiveOkDto> {
    return this.live.reaction(userId, id, dto);
  }

  @Post(':id/request-join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Заявка на участие → уведомление хосту' })
  @ApiOkResponse({ type: JoinRequestDto })
  async requestJoin(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<JoinRequestDto> {
    return this.live.requestJoin(userId, id);
  }

  @Put(':id/camera')
  @ApiOperation({ summary: 'Камера вкл/выкл (видео выкл → аватар/обложка, звук идёт всегда)' })
  @ApiOkResponse({ type: LiveDto })
  async camera(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CameraDto,
  ): Promise<LiveDto> {
    return this.live.setCamera(userId, id, dto);
  }

  @Put(':id/audio')
  @ApiOperation({ summary: 'Звук вкл/выкл' })
  @ApiOkResponse({ type: LiveDto })
  async audio(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: AudioDto,
  ): Promise<LiveDto> {
    return this.live.setAudio(userId, id, dto);
  }

  @Post(':id/kick/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выгнать зрителя/гостя (только хост)' })
  @ApiOkResponse({ type: LiveOkDto })
  async kick(
    @CurrentUser('id') hostId: string,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ): Promise<LiveOkDto> {
    return this.live.kick(hostId, id, targetUserId);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Статистика эфира' })
  @ApiOkResponse({ type: LiveStatsDto })
  async stats(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<LiveStatsDto> {
    return this.live.stats(id);
  }
}
