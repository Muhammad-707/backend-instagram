import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorDto } from '../../common/pagination/cursor.dto';
import { FeedDto } from '../posts/dto/post.dto';
import { FeedService } from './feed.service';

@ApiBearerAuth()
@ApiTags('feed')
@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get()
  @ApiOperation({
    summary: 'Получить ленту публикаций (ранжированную)',
    description:
      'Возвращает посты от подписок с алгоритмическим ранжированием (близость + свежесть + вовлечённость).',
  })
  @ApiOkResponse({ type: FeedDto })
  async getFeed(@CurrentUser('id') userId: string, @Query() dto: CursorDto): Promise<FeedDto> {
    return this.feedService.getFeed(userId, dto);
  }
}
