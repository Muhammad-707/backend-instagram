import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
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
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { UploadedFile } from '../../storage/storage.types';
import { UserBriefDto } from '../users/dto/users.dto';
import { CommentsService } from './comments.service';
import { CommentDto, CommentLikeToggleDto, CreateCommentDto, DeletedDto } from './dto/comment.dto';
import {
  ArchiveDto,
  CreatePostDto,
  DraftsQueryDto,
  ExploreQueryDto,
  FavoriteToggleDto,
  FeedDto,
  LikeToggleDto,
  MAX_MEDIA,
  MyPostsQueryDto,
  PostDto,
  ReportPostDto,
  ShareDto,
  ShareResultDto,
  TagActionDto,
  UpdatePostDto,
  UpdatePostPrivacyDto,
  ViewDto,
} from './dto/post.dto';
import { PostsService } from './posts.service';

/** Видео — самый большой лимит (100 МБ, ТЗ §6). */
const HARD_LIMIT_BYTES = 100 * 1024 * 1024;

@ApiBearerAuth()
@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly commentsService: CommentsService,
  ) {}

  // ─────────── создание ───────────

  @Post()
  @ApiOperation({
    summary: 'Создать публикацию (до 10 медиа: фото И видео)',
    description:
      'multipart/form-data. Поле «media» — файлы. caption ≤2200, хэштеги и упоминания ' +
      'парсятся из подписи автоматически. isReel=true → Reels.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        media: { type: 'array', items: { type: 'string', format: 'binary' } },
        caption: { type: 'string', example: 'Закат в горах 🏔 #travel @eraj' },
        locationId: { type: 'number', example: 1 },
        musicId: { type: 'number', example: 35 },
        taggedUserIds: { type: 'string', example: 'uuid1,uuid2' },
        filters: { type: 'string', example: 'clarendon,gingham' },
        isReel: { type: 'boolean', example: false },
      },
    },
  })
  @ApiCreatedResponse({ type: PostDto })
  @UseInterceptors(
    FilesInterceptor('media', MAX_MEDIA, {
      storage: memoryStorage(),
      limits: { fileSize: HARD_LIMIT_BYTES, files: MAX_MEDIA },
    }),
  )
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePostDto,
    @UploadedFiles() files: UploadedFile[],
  ): Promise<PostDto> {
    return this.postsService.create(userId, dto, files);
  }

  // ─────────── ленты (конкретные пути — ДО ':id') ───────────

  @Get('feed')
  @ApiOperation({
    summary: 'Лента подписок (ранжированная)',
    description:
      'userId берётся ИЗ JWT (не из query!). При FEED_RANKED=true лента ранжируется ' +
      '(близость к автору + свежесть + вовлечённость − уже просмотренное); иначе — хронология. ' +
      'В ответе: items (страница), suggested (рекомендации не-подписок), allCaughtUp («Вы всё посмотрели»). ' +
      'Курсор — смещение в ранжированном списке.',
  })
  @ApiOkResponse({ type: FeedDto })
  async feed(@CurrentUser('id') userId: string, @Query() dto: CursorDto): Promise<FeedDto> {
    return this.postsService.feed(userId, dto);
  }

  @Get('reels')
  @ApiOperation({ summary: 'Reels (только видео-посты)' })
  @ApiOkResponse({ type: [PostDto] })
  async reels(
    @CurrentUser('id') userId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<PostDto>> {
    return this.postsService.reels(userId, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Мои публикации' })
  @ApiOkResponse({ type: [PostDto] })
  async my(
    @CurrentUser('id') userId: string,
    @Query() dto: MyPostsQueryDto,
  ): Promise<CursorPage<PostDto>> {
    return this.postsService.my(userId, dto, dto.archived ?? false);
  }

  @Get('drafts')
  @ApiOperation({
    summary: 'Мои черновики и запланированные (не видны в лентах/профиле)',
    description: 'status=DRAFT или SCHEDULED для фильтра; без него — оба.',
  })
  @ApiOkResponse({ type: [PostDto] })
  async drafts(
    @CurrentUser('id') userId: string,
    @Query() dto: DraftsQueryDto,
  ): Promise<CursorPage<PostDto>> {
    return this.postsService.drafts(userId, dto, dto.status);
  }

  @Get()
  @ApiOperation({ summary: 'Explore — чужие публикации (закрытые аккаунты и блок исключены)' })
  @ApiOkResponse({ type: [PostDto] })
  async explore(
    @CurrentUser('id') userId: string,
    @Query() dto: ExploreQueryDto,
  ): Promise<CursorPage<PostDto>> {
    return this.postsService.explore(userId, dto);
  }

  // ─────────── комментарии (пути 'comments/...' — ДО ':id') ───────────

  @Delete('comments/:id')
  @ApiOperation({
    summary: 'Удалить комментарий',
    description: 'Только свой ИЛИ комментарий под своим постом. Чужой → 403 (баг softclub #17).',
  })
  @ApiOkResponse({ type: DeletedDto })
  @ApiForbiddenResponse({ description: 'Можно удалить только свой комментарий' })
  async deleteComment(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DeletedDto> {
    return this.commentsService.remove(userId, id);
  }

  @Post('comments/:id/like')
  @ApiOperation({ summary: 'Лайк комментария (toggle)' })
  @ApiOkResponse({ type: CommentLikeToggleDto })
  async likeComment(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CommentLikeToggleDto> {
    return this.commentsService.toggleLike(userId, id);
  }

  @Post('comments/:id/reply')
  @ApiOperation({ summary: 'Ответить на комментарий' })
  @ApiCreatedResponse({ type: CommentDto })
  async replyComment(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) parentId: number,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentDto> {
    return this.commentsService.reply(userId, parentId, dto.text);
  }

  @Get('comments/:id/replies')
  @ApiOperation({ summary: 'Ответы на комментарий' })
  @ApiOkResponse({ type: [CommentDto] })
  async replies(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<CommentDto>> {
    return this.commentsService.listReplies(userId, id, dto);
  }

  // ─────────── отметки / «Фото с вами» (пути 'tags/...' — ДО ':id') ───────────

  @Get('tags/pending')
  @ApiOperation({
    summary: 'Мои неподтверждённые отметки (ревью)',
    description: 'Публикации, где меня отметили, но я ещё не принял. Принять → «Фото с вами».',
  })
  @ApiOkResponse({ type: [PostDto] })
  async pendingTags(
    @CurrentUser('id') userId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<PostDto>> {
    return this.postsService.pendingTags(userId, dto);
  }

  // ─────────── один пост ───────────

  @Get(':id')
  @ApiOperation({ summary: 'Публикация по id' })
  @ApiOkResponse({ type: PostDto })
  async byId(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PostDto> {
    return this.postsService.byId(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Изменить подпись (хэштеги пересобираются)' })
  @ApiOkResponse({ type: PostDto })
  @ApiForbiddenResponse({ description: 'Это не ваша публикация' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePostDto,
  ): Promise<PostDto> {
    return this.postsService.updateCaption(userId, id, dto.caption);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить публикацию (только свою)' })
  @ApiOkResponse({ type: DeletedDto })
  @ApiForbiddenResponse({ description: 'Это не ваша публикация' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DeletedDto> {
    return this.postsService.remove(userId, id);
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'В архив' })
  @ApiOkResponse({ type: ArchiveDto })
  async archive(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ArchiveDto> {
    return this.postsService.setArchived(userId, id, true);
  }

  @Delete(':id/archive')
  @ApiOperation({ summary: 'Вернуть из архива' })
  @ApiOkResponse({ type: ArchiveDto })
  async unarchive(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ArchiveDto> {
    return this.postsService.setArchived(userId, id, false);
  }

  @Patch(':id/pin')
  @ApiOperation({ summary: 'Закрепить / открепить публикацию (max 3)' })
  @ApiOkResponse({ type: PostDto })
  @ApiForbiddenResponse({ description: 'Это не ваша публикация' })
  async pin(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PostDto> {
    return this.postsService.pin(userId, id);
  }

  @Patch(':id/privacy')
  @ApiOperation({ summary: 'Изменить настройки отображения лайков и комментариев' })
  @ApiOkResponse({ type: PostDto })
  @ApiForbiddenResponse({ description: 'Это не ваша публикация' })
  async togglePrivacy(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePostPrivacyDto,
  ): Promise<PostDto> {
    return this.postsService.togglePrivacy(userId, id, dto);
  }

  @Put(':id/publish')
  @ApiOperation({
    summary: 'Опубликовать черновик/запланированный пост сейчас',
    description: 'Снимает отложенную задачу (если была) и публикует немедленно.',
  })
  @ApiOkResponse({ type: PostDto })
  @ApiForbiddenResponse({ description: 'Это не ваша публикация' })
  async publish(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PostDto> {
    return this.postsService.publish(userId, id);
  }

  // ─────────── реакции ───────────

  @Post(':id/like')
  @ApiOperation({ summary: 'Лайк (toggle) → { liked, likesCount }' })
  @ApiOkResponse({ type: LikeToggleDto })
  async like(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LikeToggleDto> {
    return this.postsService.toggleLike(userId, id);
  }

  @Get(':id/likes')
  @ApiOperation({ summary: 'Кто лайкнул' })
  @ApiOkResponse({ type: [UserBriefDto] })
  async likes(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<UserBriefDto>> {
    return this.postsService.likes(userId, id, dto);
  }

  @Post(':id/view')
  @ApiOperation({ summary: 'Просмотр (считается 1 раз на пользователя)' })
  @ApiOkResponse({ type: ViewDto })
  async view(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ViewDto> {
    return this.postsService.view(userId, id);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: 'Сохранить/убрать (toggle). collection — имя коллекции' })
  @ApiQuery({ name: 'collection', required: false, example: 'Путешествия' })
  @ApiOkResponse({ type: FavoriteToggleDto })
  async favorite(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Query('collection') collection?: string,
  ): Promise<FavoriteToggleDto> {
    return this.postsService.toggleFavorite(userId, id, collection);
  }

  @Post(':id/share')
  @ApiOperation({ summary: 'Поделиться: в чат (toUserId) / в историю (toStory) / ссылка' })
  @ApiOkResponse({ type: ShareResultDto })
  async share(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ShareDto,
  ): Promise<ShareResultDto> {
    return this.postsService.share(userId, id, dto);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Пожаловаться на публикацию' })
  @ApiOkResponse({ description: 'Жалоба принята' })
  async report(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReportPostDto,
  ): Promise<{ message: string }> {
    return this.postsService.report(userId, id, dto.reason);
  }

  @Post(':id/tag/accept')
  @ApiOperation({
    summary: 'Принять отметку на публикации',
    description: 'Меня отметили → подтверждаю → пост появляется в моём «Фото с вами».',
  })
  @ApiOkResponse({ type: TagActionDto })
  async acceptTag(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TagActionDto> {
    return this.postsService.acceptTag(userId, id);
  }

  @Post(':id/tag/decline')
  @ApiOperation({
    summary: 'Отклонить/убрать отметку на публикации',
    description: 'Скрываю отметку: пост НЕ показывается в «Фото с вами».',
  })
  @ApiOkResponse({ type: TagActionDto })
  async declineTag(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TagActionDto> {
    return this.postsService.declineTag(userId, id);
  }

  // ─────────── комментарии к посту ───────────

  @Post(':id/comments')
  @ApiOperation({ summary: 'Добавить комментарий' })
  @ApiCreatedResponse({ type: CommentDto, description: 'Автор ВСЕГДА в ответе (не null)' })
  async addComment(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentDto> {
    return this.commentsService.add(userId, id, dto.text);
  }

  @Get(':id/comments')
  @ApiOperation({
    summary: 'Комментарии к публикации (корневые, cursor)',
    description: 'Автор всегда присутствует. repliesCount → сколько ответов у комментария.',
  })
  @ApiOkResponse({ type: [CommentDto] })
  async comments(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<CommentDto>> {
    return this.commentsService.list(userId, id, dto);
  }

  @Patch(':postId/comments/:id/pin')
  @ApiOperation({ summary: 'Закрепить / открепить комментарий к публикации (только автор поста)' })
  @ApiOkResponse({ type: CommentDto })
  @ApiForbiddenResponse({ description: 'Только автор публикации может закреплять комментарии' })
  async pinComment(
    @CurrentUser('id') userId: string,
    @Param('postId', ParseIntPipe) postId: number,
    @Param('id', ParseIntPipe) commentId: number,
  ): Promise<CommentDto> {
    return this.commentsService.pin(userId, postId, commentId);
  }
}
