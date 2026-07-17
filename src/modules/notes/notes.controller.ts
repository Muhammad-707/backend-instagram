import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateNoteDto,
  DeletedDto,
  NoteDto,
  NoteLikeItemDto,
  NoteLikeToggleDto,
  NoteReactionDto,
  NoteReplyDto,
  NoteReplyItemDto,
  NoteReplySentDto,
  UpdateNoteDto,
} from './dto/note.dto';
import { NotesService } from './notes.service';

@ApiBearerAuth()
@ApiTags('notes')
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  @ApiOperation({ summary: 'Заметки: свои + подписок (активные)' })
  @ApiOkResponse({ type: [NoteDto] })
  async feed(@CurrentUser('id') userId: string): Promise<NoteDto[]> {
    return this.notesService.feed(userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Создать заметку (text ≤60, musicId/spotifyId, bgColor, audience; TTL 24ч)',
    description:
      'Одна активная заметка на юзера — новая заменяет прежнюю. ' +
      'audience: FOLLOWERS (всем подписчикам) или CLOSE_FRIENDS (только близким друзьям).',
  })
  @ApiCreatedResponse({ type: NoteDto })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateNoteDto): Promise<NoteDto> {
    return this.notesService.create(userId, dto);
  }

  /**
   * Одна заметка по id. Метод в сервисе был давно (его зовёт create), а роута к
   * нему не существовало — `GET /notes/:id` отвечал «Cannot GET». Нужен, чтобы
   * открыть заметку по прямой ссылке, не вычитывая всю ленту.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Заметка по id' })
  @ApiOkResponse({ type: NoteDto })
  @ApiResponse({
    status: 404,
    description:
      'Не найдена, истекла или это заметка «только для близких друзей», а вы не в списке',
  })
  async byId(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NoteDto> {
    return this.notesService.byId(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Изменить свою заметку' })
  @ApiOkResponse({ type: NoteDto })
  @ApiForbiddenResponse({ description: 'Это не ваша заметка' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateNoteDto,
  ): Promise<NoteDto> {
    return this.notesService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить свою заметку' })
  @ApiOkResponse({ type: DeletedDto })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DeletedDto> {
    return this.notesService.remove(userId, id);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Лайк заметки (toggle) + уведомление LIKE_NOTE' })
  @ApiOkResponse({ type: NoteLikeToggleDto })
  async like(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NoteLikeToggleDto> {
    return this.notesService.toggleLike(userId, id);
  }

  @Get(':id/likes')
  @ApiOperation({ summary: 'Кто лайкнул (только автору)' })
  @ApiOkResponse({ type: [NoteLikeItemDto] })
  @ApiForbiddenResponse({ description: 'Список лайкнувших виден только автору' })
  async likes(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NoteLikeItemDto[]> {
    return this.notesService.likes(userId, id);
  }

  @Post(':id/reply')
  @ApiOperation({
    summary: 'Ответить на заметку → сообщение в чат',
    description: 'Создаёт Message(type=NOTE_REPLY, noteId, noteSnapshot). Нельзя отвечать на свою.',
  })
  @ApiOkResponse({ type: NoteReplySentDto })
  async reply(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NoteReplyDto,
  ): Promise<NoteReplySentDto> {
    return this.notesService.reply(userId, id, dto.text);
  }

  @Post(':id/reaction')
  @ApiOperation({
    summary: 'Эмодзи-реакция на заметку → в личку автору',
    description: 'Как реакция на историю: эмодзи уходит сообщением автору. Нельзя на свою заметку.',
  })
  @ApiOkResponse({ type: NoteReplySentDto })
  async reaction(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NoteReactionDto,
  ): Promise<NoteReplySentDto> {
    return this.notesService.reaction(userId, id, dto.emoji);
  }

  @Get(':id/replies')
  @ApiOperation({ summary: 'Ответы на заметку (только автору)' })
  @ApiOkResponse({ type: [NoteReplyItemDto] })
  @ApiForbiddenResponse({ description: 'Ответы видны только автору' })
  async replies(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NoteReplyItemDto[]> {
    return this.notesService.replies(userId, id);
  }
}
