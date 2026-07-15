import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
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
  CreateHighlightDto,
  HighlightDto,
  HighlightWithStoriesDto,
  UpdateHighlightDto,
} from './dto/highlight.dto';
import { DeletedDto } from './dto/story.dto';
import { HighlightsService } from './highlights.service';

@ApiBearerAuth()
@ApiTags('highlights')
@Controller('highlights')
export class HighlightsController {
  constructor(private readonly highlightsService: HighlightsService) {}

  @Post()
  @ApiOperation({
    summary: 'Создать «Актуальное»',
    description: 'Истории в актуальном НЕ удаляются через 24ч. Только свои истории.',
  })
  @ApiCreatedResponse({ type: HighlightDto })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateHighlightDto,
  ): Promise<HighlightDto> {
    return this.highlightsService.create(userId, dto);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Актуальное пользователя' })
  @ApiOkResponse({ type: [HighlightDto] })
  async list(
    @CurrentUser('id') viewerId: string,
    @Param('userId') targetId: string,
  ): Promise<HighlightDto[]> {
    return this.highlightsService.list(viewerId, targetId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Актуальное с историями' })
  @ApiOkResponse({ type: HighlightWithStoriesDto })
  async byId(
    @CurrentUser('id') viewerId: string,
    @Param('id') id: string,
  ): Promise<HighlightWithStoriesDto> {
    return this.highlightsService.byId(viewerId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Изменить актуальное (title / cover / состав историй)' })
  @ApiOkResponse({ type: HighlightDto })
  @ApiForbiddenResponse({ description: 'Это не ваше актуальное' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateHighlightDto,
  ): Promise<HighlightDto> {
    return this.highlightsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить актуальное (истории остаются)' })
  @ApiOkResponse({ type: DeletedDto })
  @ApiForbiddenResponse({ description: 'Это не ваше актуальное' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<DeletedDto> {
    return this.highlightsService.remove(userId, id);
  }
}
