import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorDto } from '../../common/pagination/cursor.dto';
import { UploadedFile } from '../../storage/storage.types';
import {
  AddYoursFeedDto,
  AddYoursPromptDto,
  CreateAddYoursDto,
  CreateStoryDto,
  DeletedDto,
  MAX_STORY_FILES,
  ReactionDto,
  ReactionSentDto,
  StoryDto,
  StoryInsightsDto,
  StoryLikeToggleDto,
  StoryRailItemDto,
  StoryReplyDto,
  StoryViewerDto,
} from './dto/story.dto';
import { StoriesService } from './stories.service';

const HARD_LIMIT_BYTES = 100 * 1024 * 1024;

@ApiBearerAuth()
@ApiTags('stories')
@Controller('stories')
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Post()
  @ApiOperation({
    summary: 'Создать истории (мультизагрузка до 10 файлов → до 10 отдельных Story)',
    description:
      'multipart. Поле «media» — файлы (фото/видео). Плюс musicId, musicStartSec, overlays (JSON), ' +
      'filter, closeFriendsOnly, fromPostId (репост поста в историю). Каждая история живёт 24ч.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        media: { type: 'array', items: { type: 'string', format: 'binary' } },
        musicId: { type: 'number', example: 35 },
        musicStartSec: { type: 'number', example: 12.5 },
        overlays: { type: 'string', example: '[{"type":"text","value":"Привет!"}]' },
        filter: { type: 'string', example: 'clarendon' },
        closeFriendsOnly: { type: 'boolean', example: false },
        saveToArchive: { type: 'boolean', example: true },
        fromPostId: { type: 'number', example: 12 },
      },
    },
  })
  @ApiCreatedResponse({ type: [StoryDto] })
  @UseInterceptors(
    FilesInterceptor('media', MAX_STORY_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: HARD_LIMIT_BYTES, files: MAX_STORY_FILES },
    }),
  )
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateStoryDto,
    @UploadedFiles() files: UploadedFile[],
  ): Promise<StoryDto[]> {
    return this.storiesService.create(userId, dto, files);
  }

  // Конкретные пути — ДО ':id'.

  @Get()
  @ApiOperation({
    summary: 'Рейл историй (сгруппировано по авторам)',
    description: 'isViewed и allViewed считаются на СЕРВЕРЕ. hasCloseFriends → зелёное кольцо.',
  })
  @ApiOkResponse({ type: [StoryRailItemDto] })
  async rail(@CurrentUser('id') userId: string): Promise<StoryRailItemDto[]> {
    return this.storiesService.rail(userId);
  }

  @Get('my')
  @ApiOperation({ summary: 'Мои активные истории' })
  @ApiOkResponse({ type: [StoryDto] })
  async mine(@CurrentUser('id') userId: string): Promise<StoryDto[]> {
    return this.storiesService.mine(userId);
  }

  @Get('archive')
  @ApiOperation({ summary: 'Мои истёкшие истории (архив)' })
  @ApiOkResponse({ type: [StoryDto] })
  async archive(@CurrentUser('id') userId: string): Promise<StoryDto[]> {
    return this.storiesService.archive(userId);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Истории пользователя' })
  @ApiOkResponse({ type: [StoryDto] })
  async byUser(
    @CurrentUser('id') viewerId: string,
    @Param('userId') targetId: string,
  ): Promise<StoryDto[]> {
    return this.storiesService.byUser(viewerId, targetId);
  }

  @Get('add-yours/:promptId')
  @ApiOperation({
    summary: 'Лента цепочки «Add Yours» (промпт + истории-ответы)',
    description:
      'Кто ответил на промпт. Автор промпта — первым. Закрытые/блок/close-friends фильтруются.',
  })
  @ApiOkResponse({ type: AddYoursFeedDto })
  async addYoursFeed(
    @CurrentUser('id') userId: string,
    @Param('promptId') promptId: string,
    @Query() dto: CursorDto,
  ): Promise<AddYoursFeedDto> {
    return this.storiesService.addYoursFeed(userId, promptId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'История по id' })
  @ApiOkResponse({ type: StoryDto })
  async byId(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StoryDto> {
    return this.storiesService.byId(userId, id);
  }

  @Post(':id/view')
  @ApiOperation({ summary: 'Отметить просмотренной (считается на сервере, 1 раз/зритель)' })
  @ApiOkResponse({ description: '{ viewed: true }' })
  async view(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ viewed: boolean }> {
    return this.storiesService.view(userId, id);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Лайк истории (toggle → { liked, likesCount })' })
  @ApiOkResponse({ type: StoryLikeToggleDto })
  async like(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StoryLikeToggleDto> {
    return this.storiesService.toggleLike(userId, id);
  }

  @Post(':id/reaction')
  @ApiOperation({
    summary: 'Реакция emoji → уходит сообщением в чат (можно много раз)',
  })
  @ApiOkResponse({ type: ReactionSentDto })
  async react(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReactionDto,
  ): Promise<ReactionSentDto> {
    return this.storiesService.react(userId, id, dto.emoji);
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Ответ на историю → сообщением в чат' })
  @ApiOkResponse({ type: ReactionSentDto })
  async reply(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StoryReplyDto,
  ): Promise<ReactionSentDto> {
    return this.storiesService.reply(userId, id, dto.text);
  }

  @Post(':id/add-yours')
  @ApiOperation({
    summary: 'Создать промпт «Add Yours» на своей истории («Добавь своё…»)',
    description: 'Запускает цепочку-эстафету. Сама история становится первым звеном.',
  })
  @ApiCreatedResponse({ type: AddYoursPromptDto })
  @ApiForbiddenResponse({ description: 'Это не ваша история' })
  async createAddYours(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAddYoursDto,
  ): Promise<AddYoursPromptDto> {
    return this.storiesService.createAddYoursPrompt(userId, id, dto);
  }

  @Get(':id/insights')
  @ApiOperation({ summary: 'Аналитика истории (только автору): просмотры, лайки, реакции, ответы' })
  @ApiOkResponse({ type: StoryInsightsDto })
  @ApiForbiddenResponse({ description: 'Аналитика видна только автору' })
  async insights(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StoryInsightsDto> {
    return this.storiesService.insights(userId, id);
  }

  @Get(':id/viewers')
  @ApiOperation({
    summary: 'Список зрителей (только автору): кто смотрел + лайкнул + реакция',
  })
  @ApiOkResponse({ type: [StoryViewerDto] })
  @ApiForbiddenResponse({ description: 'Список зрителей виден только автору' })
  async viewers(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StoryViewerDto[]> {
    return this.storiesService.viewers(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить свою историю' })
  @ApiOkResponse({ type: DeletedDto })
  @ApiForbiddenResponse({ description: 'Это не ваша история' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DeletedDto> {
    if (Number.isNaN(id)) throw new BadRequestException('Некорректный id');
    return this.storiesService.remove(userId, id);
  }
}
