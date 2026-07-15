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
  ApiTags,
} from '@nestjs/swagger';
import { CallType } from '@prisma/client';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { UploadedFile as MulterFile } from '../../storage/storage.types';
import { ChatService } from './chat.service';
import {
  BulkDeleteDto,
  CallStartedDto,
  ChatCreatedDto,
  ChatDetailDto,
  ChatListItemDto,
  CreateChatDto,
  DeletedCountDto,
  EditMessageDto,
  MessageDto,
  MessageRequestItemDto,
  MuteDto,
  NicknameDto,
  OkDto,
  ReactionDto,
  ReportChatDto,
  SendMessageDto,
  ThemeDto,
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
