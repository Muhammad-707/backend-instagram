import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPage } from '../../common/pagination/cursor.dto';
import {
  AccountDeletedDto,
  AddSearchedUserDto,
  AddSearchTextDto,
  DeletedCountDto,
  ReportCreatedDto,
  ReportUserDto,
  SearchedUserItemDto,
  SearchHistoryItemDto,
  SearchUsersDto,
  SuggestionDto,
  UserBriefDto,
} from './dto/users.dto';
import { UsersService } from './users.service';

@ApiBearerAuth()
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Поиск пользователей (по userName И fullName, подстрокой)',
    description: 'Курсорная пагинация. Заблокированные в выдачу не попадают.',
  })
  @ApiOkResponse({ type: [UserBriefDto] })
  async search(
    @CurrentUser('id') userId: string,
    @Query() dto: SearchUsersDto,
  ): Promise<CursorPage<UserBriefDto>> {
    return this.usersService.search(userId, dto);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Рекомендации для вас',
    description: 'Кого читают мои подписки. followedBy → «Подписаны: m.ibrohim».',
  })
  @ApiOkResponse({ type: [SuggestionDto] })
  async suggestions(@CurrentUser('id') userId: string): Promise<SuggestionDto[]> {
    return this.usersService.suggestions(userId);
  }

  // ─────────── история поиска: текст ───────────
  // Важно: конкретные пути объявлены ДО '/:id/report', иначе ':id' перехватил бы 'search-history'.

  @Post('search-history')
  @ApiOperation({ summary: 'Добавить текстовый запрос в историю поиска' })
  @ApiOkResponse({ type: SearchHistoryItemDto })
  async addSearchText(
    @CurrentUser('id') userId: string,
    @Body() dto: AddSearchTextDto,
  ): Promise<SearchHistoryItemDto> {
    return this.usersService.addSearchText(userId, dto.text);
  }

  @Get('search-history')
  @ApiOperation({ summary: 'История текстовых запросов (с createdAt!)' })
  @ApiOkResponse({ type: [SearchHistoryItemDto] })
  async getSearchText(@CurrentUser('id') userId: string): Promise<SearchHistoryItemDto[]> {
    return this.usersService.getSearchText(userId);
  }

  @Delete('search-history/users')
  @ApiOperation({ summary: 'Очистить историю просмотренных профилей' })
  @ApiOkResponse({ type: DeletedCountDto })
  async clearSearchedUsers(@CurrentUser('id') userId: string): Promise<DeletedCountDto> {
    return this.usersService.clearSearchedUsers(userId);
  }

  @Delete('search-history/user/:id')
  @ApiOperation({ summary: 'Удалить один профиль из истории поиска' })
  @ApiOkResponse({ type: DeletedCountDto })
  async deleteSearchedUser(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<DeletedCountDto> {
    return this.usersService.deleteSearchedUser(userId, id);
  }

  @Delete('search-history/:id')
  @ApiOperation({ summary: 'Удалить один текстовый запрос из истории' })
  @ApiOkResponse({ type: DeletedCountDto })
  async deleteSearchText(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<DeletedCountDto> {
    return this.usersService.deleteSearchText(userId, id);
  }

  @Delete('search-history')
  @ApiOperation({ summary: 'Очистить историю текстовых запросов' })
  @ApiOkResponse({ type: DeletedCountDto })
  async clearSearchText(@CurrentUser('id') userId: string): Promise<DeletedCountDto> {
    return this.usersService.clearSearchText(userId);
  }

  // ─────────── история поиска: юзеры ───────────

  @Post('search-history/user')
  @ApiOperation({ summary: 'Добавить профиль в историю поиска (повтор — поднимает наверх)' })
  @ApiOkResponse({ type: SearchedUserItemDto })
  async addSearchedUser(
    @CurrentUser('id') userId: string,
    @Body() dto: AddSearchedUserDto,
  ): Promise<SearchedUserItemDto> {
    return this.usersService.addSearchedUser(userId, dto.searchedUserId);
  }

  @Get('search-history/users')
  @ApiOperation({ summary: 'История просмотренных профилей (с createdAt!)' })
  @ApiOkResponse({ type: [SearchedUserItemDto] })
  async getSearchedUsers(@CurrentUser('id') userId: string): Promise<SearchedUserItemDto[]> {
    return this.usersService.getSearchedUsers(userId);
  }

  // ─────────── аккаунт ───────────

  @Delete('me')
  @ApiOperation({
    summary: 'Удалить свой аккаунт (soft-delete)',
    description: '30 дней на восстановление. Все сессии отзываются сразу.',
  })
  @ApiOkResponse({ type: AccountDeletedDto })
  async deleteMe(@CurrentUser('id') userId: string): Promise<AccountDeletedDto> {
    return this.usersService.softDeleteMe(userId);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Пожаловаться на пользователя' })
  @ApiOkResponse({ type: ReportCreatedDto })
  async report(
    @CurrentUser('id') userId: string,
    @Param('id') targetId: string,
    @Body() dto: ReportUserDto,
  ): Promise<ReportCreatedDto> {
    return this.usersService.report(userId, targetId, dto.reason);
  }
}
