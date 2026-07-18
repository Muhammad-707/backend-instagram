import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AnswerResultDto,
  AnswerStickerDto,
  CreateStickerDto,
  StickerDto,
  StickerResultsDto,
} from './dto/sticker.dto';
import { StoryStickersService } from './story-stickers.service';

@ApiBearerAuth()
@ApiTags('stories')
@Controller('stories/:id/stickers')
export class StoryStickersController {
  constructor(private readonly service: StoryStickersService) {}

  @Post()
  @ApiOperation({
    summary: 'Добавить интерактивный стикер на СВОЮ историю',
    description: 'POLL/QUIZ/QUESTION/SLIDER/COUNTDOWN/LINK. LINK — только для verified.',
  })
  @ApiCreatedResponse({ type: StickerDto })
  @ApiForbiddenResponse({ description: 'Это не ваша история / LINK без галочки' })
  async create(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) storyId: number,
    @Body() dto: CreateStickerDto,
  ): Promise<StickerDto> {
    return this.service.create(userId, storyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Стикеры истории (для зрителя; правильный ответ QUIZ скрыт до ответа)' })
  @ApiOkResponse({ type: [StickerDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) storyId: number,
  ): Promise<StickerDto[]> {
    return this.service.list(userId, storyId);
  }

  @Post(':stickerId/answer')
  @ApiOperation({
    summary: 'Ответить на стикер',
    description:
      'POLL/QUIZ → optionIndex, QUESTION → text, SLIDER → sliderValue. Повтор меняет ответ.',
  })
  @ApiOkResponse({ type: AnswerResultDto })
  async answer(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) storyId: number,
    @Param('stickerId') stickerId: string,
    @Body() dto: AnswerStickerDto,
  ): Promise<AnswerResultDto> {
    return this.service.answer(userId, storyId, stickerId, dto);
  }

  @Get(':stickerId/results')
  @ApiOperation({ summary: 'Итоги стикера (только автору истории)' })
  @ApiOkResponse({ type: StickerResultsDto })
  @ApiForbiddenResponse({ description: 'Итоги видит только автор истории' })
  async results(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) storyId: number,
    @Param('stickerId') stickerId: string,
  ): Promise<StickerResultsDto> {
    return this.service.results(userId, storyId, stickerId);
  }
}
