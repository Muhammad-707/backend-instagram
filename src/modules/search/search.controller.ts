import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PostDto } from '../posts/dto/post.dto';
import { SearchQueryDto, SearchResultDto, TopResultDto } from './dto/search.dto';
import { SearchService } from './search.service';

@ApiBearerAuth()
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Комбинированный поиск: аккаунты + хэштеги + локации одним ответом',
    description: 'Поиск по userName И fullName (подстрока). Заблокированные вырезаны.',
  })
  @ApiOkResponse({ type: SearchResultDto })
  async searchAll(
    @CurrentUser('id') userId: string,
    @Query() dto: SearchQueryDto,
  ): Promise<SearchResultDto> {
    return this.search.searchAll(userId, dto.q);
  }

  @Get('explore')
  @ApiOperation({
    summary: 'Сетка Explore: посты И видео вперемешку',
    description: 'likesCount/commentsCount для hover. Без своих постов и заблокированных, cursor.',
  })
  @ApiOkResponse({ type: PostDto, isArray: true })
  async explore(
    @CurrentUser('id') userId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<PostDto>> {
    return this.search.explore(userId, dto);
  }

  @Get('top')
  @ApiOperation({ summary: 'Тренды: популярные хэштеги + аккаунты недели' })
  @ApiOkResponse({ type: TopResultDto })
  async top(@CurrentUser('id') userId: string): Promise<TopResultDto> {
    return this.search.top(userId);
  }

  @Get('hashtag/:name')
  @ApiOperation({ summary: 'Все посты с хэштегом (cursor)' })
  @ApiOkResponse({ type: PostDto, isArray: true })
  async byHashtag(
    @CurrentUser('id') userId: string,
    @Param('name') name: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<PostDto>> {
    return this.search.byHashtag(userId, name, dto);
  }
}
