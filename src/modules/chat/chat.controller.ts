import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CallType } from '@prisma/client';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { UploadedFile as MulterFile } from '../../storage/storage.types';
import { ChatService } from './chat.service';
import {
  AddParticipantsDto,
  BulkDeleteDto,
  CallStartedDto,
  CallStateDto,
  ChatCreatedDto,
  ChatDetailDto,
  ChatListItemDto,
  CreateChatDto,
  CreateGroupChatDto,
  DeletedCountDto,
  EditMessageDto,
  GroupCreatedDto,
  IceServersDto,
  UpdateGroupTitleDto,
  MessageDto,
  MessageRequestItemDto,
  MuteDto,
  NicknameDto,
  OkDto,
  ReactionDto,
  ReportChatDto,
  SendMessageDto,
  ThemeDto,
  VanishDto,
} from './dto/chat.dto';

const HARD_LIMIT_BYTES = 100 * 1024 * 1024;

@ApiBearerAuth()
@ApiTags('chats')
@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  @ApiOperation({
    summary: 'Список чатов',
    description: '+ lastMessage, lastMessageAt, unreadCount, peer, isOnline, lastSeenAt.',
  })
  @ApiOkResponse({ type: [ChatListItemDto] })
  async list(@CurrentUser('id') userId: string): Promise<ChatListItemDto[]> {
    return this.chatService.list(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Начать чат (идемпотентно)' })
  @ApiCreatedResponse({ type: ChatCreatedDto })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChatDto,
  ): Promise<ChatCreatedDto> {
    return this.chatService.createOrGet(userId, dto.receiverUserId);
  }

  // ─── группы: 'group' — ДО ':id', иначе параметр перехватит путь ───

  @Post('group')
  @ApiOperation({
    summary: 'Создать групповой чат',
    description:
      'Создатель становится админом группы. Минимум 2 собеседника (иначе это обычный чат 1-на-1), ' +
      'максимум 32 участника. В отличие от 1-на-1, НЕ идемпотентно: две группы с одним составом — разные группы.',
  })
  @ApiCreatedResponse({ type: GroupCreatedDto })
  @ApiResponse({ status: 400, description: 'Меньше 2 собеседников / больше 32 участников' })
  async createGroup(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateGroupChatDto,
  ): Promise<GroupCreatedDto> {
    return this.chatService.createGroup(userId, dto);
  }

  @Post(':id/participants')
  @ApiOperation({
    summary: 'Добавить участников в группу',
    description: 'Добавлять может любой участник группы (как в IG).',
  })
  @ApiOkResponse({ type: OkDto })
  async addParticipants(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) chatId: number,
    @Body() dto: AddParticipantsDto,
  ): Promise<OkDto> {
    return this.chatService.addParticipants(userId, chatId, dto.userIds);
  }

  @Delete(':id/participants/:userId')
  @ApiOperation({
    summary: 'Удалить участника из группы',
    description:
      'Только админ (создатель группы). Себя удалить нельзя — для этого выход из группы.',
  })
  @ApiOkResponse({ type: OkDto })
  @ApiResponse({ status: 403, description: 'Вы не админ группы' })
  async removeParticipant(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) chatId: number,
    @Param('userId') targetId: string,
  ): Promise<OkDto> {
    return this.chatService.removeParticipant(userId, chatId, targetId);
  }

  @Post(':id/leave')
  @ApiOperation({
    summary: 'Выйти из группы',
    description:
      'Может любой участник. Если вышел админ — админом становится самый давний из оставшихся. ' +
      'Вышел последний — группа удаляется.',
  })
  @ApiOkResponse({ type: OkDto })
  async leaveGroup(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) chatId: number,
  ): Promise<OkDto> {
    return this.chatService.leaveGroup(userId, chatId);
  }

  @Put(':id/title')
  @ApiOperation({
    summary: 'Переименовать группу',
    description: 'Может любой участник (как в IG).',
  })
  @ApiOkResponse({ type: OkDto })
  async updateGroupTitle(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) chatId: number,
    @Body() dto: UpdateGroupTitleDto,
  ): Promise<OkDto> {
    return this.chatService.updateGroupTitle(userId, chatId, dto.title);
  }

  // ─── звонки: 'calls/...' — ДО ':id' ───

  /**
   * ICE-серверы для WebRTC. Отдаём с сервера, а не хардкодим во фронте: учётки
   * TURN меняются, а без TURN звонок между двумя NAT (мобильный интернет) просто
   * не соберётся — STUN один этого не решает.
   */
  @Get('calls/ice-servers')
  @ApiOperation({
    summary: 'ICE-серверы (STUN/TURN) для WebRTC',
    description:
      'Отдать как есть в `new RTCPeerConnection({ iceServers })`. ' +
      '`hasTurn: false` — TURN не настроен, звонок между NAT может не соединиться.',
  })
  @ApiOkResponse({ type: IceServersDto })
  iceServers(): IceServersDto {
    return this.chatService.iceServers();
  }

  @Post('calls/:callId/answer')
  @ApiOperation({
    summary: 'Взять трубку',
    description: 'RINGING → ONGOING. Длительность считается от этого момента.',
  })
  @ApiOkResponse({ type: CallStateDto })
  async answerCall(
    @CurrentUser('id') userId: string,
    @Param('callId') callId: string,
  ): Promise<CallStateDto> {
    return this.chatService.answerCall(userId, callId);
  }

  @Post('calls/:callId/decline')
  @ApiOperation({
    summary: 'Сбросить входящий',
    description: 'RINGING → DECLINED + строка в чате.',
  })
  @ApiOkResponse({ type: CallStateDto })
  async declineCall(
    @CurrentUser('id') userId: string,
    @Param('callId') callId: string,
  ): Promise<CallStateDto> {
    return this.chatService.declineCall(userId, callId);
  }

  @Post('calls/:callId/end')
  @ApiOperation({
    summary: 'Завершить звонок',
    description:
      'ONGOING → ENDED (+ длительность). Если трубку так и не взяли — MISSED (пропущенный), ' +
      'а не разговор нулевой длины. Идемпотентно: обе стороны часто шлют end одновременно.',
  })
  @ApiOkResponse({ type: CallStateDto })
  async endCall(
    @CurrentUser('id') userId: string,
    @Param('callId') callId: string,
  ): Promise<CallStateDto> {
    return this.chatService.endCall(userId, callId);
  }

  @Get(':id/calls')
  @ApiOperation({ summary: 'История звонков чата (курсорная)' })
  @ApiOkResponse({ type: [CallStateDto] })
  async calls(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) chatId: number,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<CallStateDto>> {
    return this.chatService.calls(userId, chatId, dto);
  }

  // ─── сообщения: пути 'messages/...' и 'requests/...' — ДО ':id' ───

  @Put('messages/:id')
  @ApiOperation({ summary: 'Редактировать сообщение (≤15 мин, только своё)' })
  @ApiOkResponse({ type: MessageDto })
  @ApiForbiddenResponse({ description: 'Можно редактировать только своё' })
  async editMessage(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditMessageDto,
  ): Promise<MessageDto> {
    return this.chatService.editMessage(userId, id, dto.text);
  }

  @Delete('messages/:id')
  @ApiOperation({ summary: 'Удалить сообщение (OwnerGuard: только своё)' })
  @ApiOkResponse({ type: OkDto })
  @ApiForbiddenResponse({ description: 'Можно удалить только своё сообщение' })
  async deleteMessage(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OkDto> {
    return this.chatService.deleteMessage(userId, id);
  }

  @Post('messages/bulk-delete')
  @ApiOperation({ summary: 'Удалить несколько своих сообщений' })
  @ApiOkResponse({ type: DeletedCountDto })
  async bulkDelete(
    @CurrentUser('id') userId: string,
    @Body() dto: BulkDeleteDto,
  ): Promise<DeletedCountDto> {
    return this.chatService.bulkDelete(userId, dto.messageIds);
  }

  @Post('messages/:id/reaction')
  @ApiOperation({ summary: 'Реакция на сообщение' })
  @ApiOkResponse({ type: OkDto })
  async react(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReactionDto,
  ): Promise<OkDto> {
    return this.chatService.react(userId, id, dto.emoji);
  }

  @Delete('messages/:id/reaction')
  @ApiOperation({ summary: 'Убрать реакцию' })
  @ApiOkResponse({ type: OkDto })
  async unreact(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OkDto> {
    return this.chatService.unreact(userId, id);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Запросы на переписку (от неподписанных)' })
  @ApiOkResponse({ type: [MessageRequestItemDto] })
  async requests(@CurrentUser('id') userId: string): Promise<MessageRequestItemDto[]> {
    return this.chatService.requests(userId);
  }

  @Post('requests/:id/accept')
  @ApiOperation({ summary: 'Принять запрос на переписку' })
  @ApiOkResponse({ type: OkDto })
  async acceptRequest(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<OkDto> {
    return this.chatService.acceptRequest(userId, id);
  }

  @Post('requests/:id/decline')
  @ApiOperation({ summary: 'Отклонить запрос (строка обновляется, не плодится)' })
  @ApiOkResponse({ type: OkDto })
  async declineRequest(@CurrentUser('id') userId: string, @Param('id') id: string): Promise<OkDto> {
    return this.chatService.declineRequest(userId, id);
  }

  // ─── конкретный чат ───

  @Get(':id')
  @ApiOperation({ summary: 'Детали чата' })
  @ApiOkResponse({ type: ChatDetailDto })
  async detail(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ChatDetailDto> {
    return this.chatService.detail(userId, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Сообщения чата (cursor)' })
  @ApiOkResponse({ type: [MessageDto] })
  async messages(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<MessageDto>> {
    return this.chatService.messages(userId, id, dto);
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Отправить сообщение',
    description: 'text / фото / видео / голосовое (audio) / стикер / ответ (replyToId) / пост.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', example: 'Привет!' },
        file: { type: 'string', format: 'binary' },
        replyToId: { type: 'number' },
        sharedPostId: { type: 'number' },
        stickerUrl: { type: 'string' },
      },
    },
  })
  @ApiCreatedResponse({ type: MessageDto })
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: HARD_LIMIT_BYTES } }),
  )
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
    @UploadedFile() file: MulterFile | undefined,
  ): Promise<MessageDto> {
    return this.chatService.sendMessage(userId, id, dto, file);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Отметить чат прочитанным («Просмотрено»)' })
  @ApiOkResponse({ type: OkDto })
  async markRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OkDto> {
    return this.chatService.markRead(userId, id);
  }

  @Put(':id/theme')
  @ApiOperation({ summary: 'Тема чата' })
  @ApiOkResponse({ type: OkDto })
  async setTheme(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ThemeDto,
  ): Promise<OkDto> {
    return this.chatService.setTheme(userId, id, dto.theme);
  }

  @Put(':id/nickname')
  @ApiOperation({ summary: 'Никнейм собеседника в чате' })
  @ApiOkResponse({ type: OkDto })
  async setNickname(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NicknameDto,
  ): Promise<OkDto> {
    return this.chatService.setNickname(userId, id, dto.userId, dto.nickname);
  }

  @Put(':id/mute')
  @ApiOperation({ summary: 'Заглушить/включить уведомления чата' })
  @ApiOkResponse({ type: OkDto })
  async setMute(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MuteDto,
  ): Promise<OkDto> {
    return this.chatService.setMute(userId, id, dto.muted);
  }

  @Put(':id/vanish')
  @ApiOperation({
    summary: 'Vanish mode — режим исчезающих сообщений',
    description:
      'Пока включён, новые сообщения исчезают у обоих при закрытии чата (POST /:id/close).',
  })
  @ApiOkResponse({ type: OkDto })
  async setVanish(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VanishDto,
  ): Promise<OkDto> {
    return this.chatService.setVanishMode(userId, id, dto.enabled);
  }

  @Post(':id/close')
  @ApiOperation({
    summary: 'Закрыть чат (уйти с экрана) — сжечь увиденные исчезающие сообщения',
    description: 'Vanishing-сообщения, которые вы уже видели, удаляются у всех участников.',
  })
  @ApiOkResponse({ type: DeletedCountDto })
  async closeChat(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DeletedCountDto> {
    return this.chatService.closeChat(userId, id);
  }

  @Post('messages/:id/open')
  @ApiOperation({
    summary: 'Открыть медиа «просмотр один раз»',
    description: 'Возвращает media один раз; после открытия оно скрывается для всех, кроме автора.',
  })
  @ApiOkResponse({ type: MessageDto })
  async openViewOnce(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MessageDto> {
    return this.chatService.openViewOnce(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить чат (выйти из него)' })
  @ApiOkResponse({ type: OkDto })
  async deleteChat(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OkDto> {
    return this.chatService.deleteChat(userId, id);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Пожаловаться на чат' })
  @ApiOkResponse({ type: OkDto })
  async report(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReportChatDto,
  ): Promise<OkDto> {
    return this.chatService.report(userId, id, dto.reason);
  }

  @Post(':id/call')
  @ApiOperation({ summary: 'Начать звонок (WebRTC-сигналинг через сокет)' })
  @ApiQuery({ name: 'type', enum: CallType, required: false })
  @ApiOkResponse({ type: CallStartedDto })
  async call(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Query('type') type?: string,
  ): Promise<CallStartedDto> {
    return this.chatService.startCall(
      userId,
      id,
      type === 'AUDIO' ? CallType.AUDIO : CallType.VIDEO,
    );
  }
}
