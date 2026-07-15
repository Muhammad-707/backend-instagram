import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CallType, MsgType, Prisma, RequestStatus, ReportTargetType } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { ChatUtilService } from '../../common/chat/chat-util.service';
import { buildCursorPage, CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadedFile } from '../../storage/storage.types';
import { FileValidator } from '../../storage/file-validator';
import { MediaService } from '../../storage/media.service';
import { StorageService } from '../../storage/storage.service';
import { PresenceService } from '../realtime/presence.service';
import { RealtimeService } from '../realtime/realtime.service';
import { UserBriefDto } from '../users/dto/users.dto';
import {
  CallStartedDto,
  ChatCreatedDto,
  ChatDetailDto,
  ChatListItemDto,
  DeletedCountDto,
  MessageDto,
  MessageRequestItemDto,
  OkDto,
  SendMessageDto,
} from './dto/chat.dto';
import { EDIT_WINDOW_MS } from './dto/chat.dto';

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

const MESSAGE_SELECT = {
  id: true,
  chatId: true,
  senderId: true,
  text: true,
  type: true,
  mediaUrl: true,
  duration: true,
  replyToId: true,
  sharedPostId: true,
  noteSnapshot: true,
  editedAt: true,
  isDeleted: true,
  sentAt: true,
  reactions: { select: { userId: true, emoji: true } },
  reads: { select: { userId: true } },
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;
type UserBriefRow = Prisma.UserGetPayload<{ select: typeof USER_BRIEF }>;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly chatUtil: ChatUtilService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly validator: FileValidator,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
  ) {}

  // ─────────────── список и создание ───────────────

  async list(userId: string): Promise<ChatListItemDto[]> {
    const parts = await this.prisma.chatParticipant.findMany({
      where: { userId, chat: { isGroup: false } },
      select: {
        chatId: true,
        nickname: true,
        isMuted: true,
        lastReadAt: true,
        chat: {
          select: {
            id: true,
            theme: true,
            participants: {
              where: { userId: { not: userId } },
              select: { user: { select: USER_BRIEF } },
            },
            messages: {
              orderBy: { sentAt: 'desc' },
              take: 1,
              select: MESSAGE_SELECT,
            },
          },
        },
      },
    });

    // Собеседники — для presence одним махом.
    const peerIds = parts
      .map((p) => p.chat.participants[0]?.user.id)
      .filter((id): id is string => Boolean(id));
    const onlineMap = await this.presence.onlineMap(peerIds);

    const items = await Promise.all(
      parts.map(async (p) => {
        const peer = p.chat.participants[0]?.user;
        if (!peer) return null;

        const last = p.chat.messages[0] ?? null;
        const unreadCount = await this.prisma.message.count({
          where: {
            chatId: p.chatId,
            senderId: { not: userId },
            isDeleted: false,
            ...(p.lastReadAt ? { sentAt: { gt: p.lastReadAt } } : {}),
          },
        });

        const online = onlineMap.get(peer.id) ?? false;
        const item: ChatListItemDto = {
          id: p.chatId,
          peer: this.toBrief(peer),
          peerNickname: p.nickname,
          theme: p.chat.theme,
          isMuted: p.isMuted,
          lastMessage: last ? this.toMessage(last, userId) : null,
          lastMessageAt: last?.sentAt ?? null,
          unreadCount,
          isOnline: online,
          lastSeenAt: online ? null : await this.presence.lastSeen(peer.id),
        };
        return item;
      }),
    );

    return items
      .filter((i): i is ChatListItemDto => i !== null)
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  }

  /** Идемпотентно: если чат с этим собеседником есть — возвращаем его. */
  async createOrGet(userId: string, receiverUserId: string): Promise<ChatCreatedDto> {
    if (userId === receiverUserId) {
      throw new BadRequestException('Нельзя начать чат с самим собой');
    }
    await this.access.assertNotBlocked(userId, receiverUserId);

    const receiver = await this.prisma.user.findFirst({
      where: { id: receiverUserId, isDeleted: false },
      select: { id: true },
    });
    if (!receiver) throw new NotFoundException('Пользователь не найден');

    const existing = await this.prisma.chat.findFirst({
      where: {
        isGroup: false,
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: receiverUserId } } },
        ],
      },
      select: { id: true },
    });
    const chat = existing ?? (await this.chatUtil.findOrCreateDirectChat(userId, receiverUserId));

    // Подписан на собеседника — переписка сразу в основных.
    if (await this.access.isFollowing(userId, receiverUserId)) {
      return { id: chat.id, existed: existing !== null, isRequest: false };
    }

    // Уже принятый запрос — тоже не «Запрос», это обычный чат.
    const req = await this.prisma.messageRequest.findUnique({
      where: { fromUserId_toUserId: { fromUserId: userId, toUserId: receiverUserId } },
      select: { status: true },
    });
    if (req?.status === RequestStatus.ACCEPTED) {
      return { id: chat.id, existed: existing !== null, isRequest: false };
    }

    // Иначе — «Запрос». @@unique(from,to): повтор после DECLINED обновляет строку в PENDING
    // (а не плодит новую) — даже если чат уже существовал.
    await this.prisma.messageRequest.upsert({
      where: { fromUserId_toUserId: { fromUserId: userId, toUserId: receiverUserId } },
      create: { fromUserId: userId, toUserId: receiverUserId, chatId: chat.id },
      update: { status: RequestStatus.PENDING, createdAt: new Date(), decidedAt: null },
    });

    return { id: chat.id, existed: existing !== null, isRequest: true };
  }

  async detail(userId: string, chatId: number): Promise<ChatDetailDto> {
    const { peer, part } = await this.loadChat(userId, chatId);
    const online = await this.presence.isOnline(peer.id);
    return {
      id: chatId,
      peer: this.toBrief(peer),
      theme: part.chat.theme,
      isMuted: part.isMuted,
      isOnline: online,
      lastSeenAt: online ? null : await this.presence.lastSeen(peer.id),
    };
  }

  // ─────────────── сообщения ───────────────

  async messages(userId: string, chatId: number, dto: CursorDto): Promise<CursorPage<MessageDto>> {
    await this.loadChat(userId, chatId);

    const rows = await this.prisma.message.findMany({
      where: { chatId },
      select: MESSAGE_SELECT,
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });

    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return { ...page, items: page.items.map((m) => this.toMessage(m, userId)) };
  }

  async sendMessage(
    userId: string,
    chatId: number,
    dto: SendMessageDto,
    file?: UploadedFile,
  ): Promise<MessageDto> {
    const { peer } = await this.loadChat(userId, chatId);
    await this.access.assertNotBlocked(userId, peer.id);

    let type: MsgType = MsgType.TEXT;
    let mediaUrl: string | null = null;
    let duration: number | null = null;

    if (file) {
      const validated = await this.validator.validate(file);
      const processed = await this.media.process(validated);
      const key = this.storage.buildKey(validated.kind, processed.ext);
      mediaUrl = await this.storage.put(key, processed.buffer, processed.mime);
      duration = processed.duration ?? null;
      // Голосовое — это audio; фото/видео — по типу файла.
      type =
        validated.kind === 'AUDIO'
          ? MsgType.AUDIO
          : validated.kind === 'VIDEO'
            ? MsgType.VIDEO
            : MsgType.IMAGE;
    } else if (dto.stickerUrl) {
      type = MsgType.STICKER;
      mediaUrl = dto.stickerUrl;
    } else if (dto.sharedPostId) {
      type = MsgType.POST_SHARE;
    } else if (!dto.text?.trim()) {
      throw new BadRequestException('Пустое сообщение: нужен text, файл, стикер или пост');
    }

    if (dto.replyToId) {
      const parent = await this.prisma.message.findUnique({
        where: { id: dto.replyToId },
        select: { chatId: true },
      });
      if (!parent || parent.chatId !== chatId) {
        throw new NotFoundException('Сообщение, на которое вы отвечаете, не найдено');
      }
    }

    const message = await this.prisma.message.create({
      data: {
        chatId,
        senderId: userId,
        text: dto.text ?? null,
        type,
        mediaUrl,
        duration,
        replyToId: dto.replyToId ?? null,
        sharedPostId: dto.sharedPostId ?? null,
      },
      select: MESSAGE_SELECT,
    });

    const dtoOut = this.toMessage(message, userId);
    // Мгновенная доставка собеседнику (и в другие мои вкладки).
    this.realtime.emitToUsers([peer.id], 'message:new', dtoOut);
    return dtoOut;
  }

  /** Редактировать можно ≤15 минут и только своё. */
  async editMessage(userId: string, messageId: number, text: string): Promise<MessageDto> {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { senderId: true, sentAt: true, chatId: true, isDeleted: true },
    });
    if (!msg || msg.isDeleted) throw new NotFoundException('Сообщение не найдено');
    if (msg.senderId !== userId) throw new ForbiddenException('Можно редактировать только своё');
    if (Date.now() - msg.sentAt.getTime() > EDIT_WINDOW_MS) {
      throw new BadRequestException('Редактировать можно в течение 15 минут');
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { text, editedAt: new Date() },
      select: MESSAGE_SELECT,
    });

    const out = this.toMessage(updated, userId);
    const peers = await this.chatPeers(msg.chatId, userId);
    this.realtime.emitToUsers(peers, 'message:edited', out);
    return out;
  }

  /**
   * Баг softclub #11: delete-message не проверял владельца — можно было удалить чужое.
   * Здесь — только своё, иначе 403.
   */
  async deleteMessage(userId: string, messageId: number): Promise<OkDto> {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { senderId: true, chatId: true, isDeleted: true },
    });
    if (!msg || msg.isDeleted) throw new NotFoundException('Сообщение не найдено');
    if (msg.senderId !== userId)
      throw new ForbiddenException('Можно удалить только своё сообщение');

    // Мягкое удаление: «Сообщение удалено» в чате, история переписки не рвётся.
    await this.prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true, text: null, mediaUrl: null },
    });

    const peers = await this.chatPeers(msg.chatId, userId);
    this.realtime.emitToUsers(peers, 'message:deleted', { id: messageId, chatId: msg.chatId });
    return { ok: true, message: 'Сообщение удалено' };
  }

  async bulkDelete(userId: string, messageIds: number[]): Promise<DeletedCountDto> {
    const own = await this.prisma.message.findMany({
      where: { id: { in: messageIds }, senderId: userId, isDeleted: false },
      select: { id: true, chatId: true },
    });
    if (own.length === 0) return { deleted: 0 };

    await this.prisma.message.updateMany({
      where: { id: { in: own.map((m) => m.id) } },
      data: { isDeleted: true, text: null, mediaUrl: null },
    });

    // Оповещаем по каждому затронутому чату.
    const byChat = new Map<number, number[]>();
    for (const m of own) {
      const arr = byChat.get(m.chatId) ?? [];
      arr.push(m.id);
      byChat.set(m.chatId, arr);
    }
    for (const [chatId, ids] of byChat) {
      const peers = await this.chatPeers(chatId, userId);
      this.realtime.emitToUsers(peers, 'message:deleted', { ids, chatId });
    }

    return { deleted: own.length };
  }

  // ─────────────── реакции / просмотрено ───────────────

  async react(userId: string, messageId: number, emoji: string): Promise<OkDto> {
    const msg = await this.loadMessageInMyChat(userId, messageId);
    await this.prisma.messageReaction.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId, emoji },
      update: { emoji },
    });
    const peers = await this.chatPeers(msg.chatId, userId);
    this.realtime.emitToUsers(peers, 'message:reaction', { messageId, userId, emoji });
    return { ok: true };
  }

  async unreact(userId: string, messageId: number): Promise<OkDto> {
    const msg = await this.loadMessageInMyChat(userId, messageId);
    await this.prisma.messageReaction.deleteMany({ where: { messageId, userId } });
    const peers = await this.chatPeers(msg.chatId, userId);
    this.realtime.emitToUsers(peers, 'message:reaction', { messageId, userId, emoji: null });
    return { ok: true };
  }

  /** «Просмотрено»: двигаем lastReadAt и помечаем непрочитанные MessageRead. */
  async markRead(userId: string, chatId: number): Promise<OkDto> {
    await this.loadChat(userId, chatId);
    const now = new Date();

    await this.prisma.chatParticipant.update({
      where: { chatId_userId: { chatId, userId } },
      data: { lastReadAt: now },
    });

    const unread = await this.prisma.message.findMany({
      where: {
        chatId,
        senderId: { not: userId },
        reads: { none: { userId } },
      },
      select: { id: true },
    });
    if (unread.length > 0) {
      await this.prisma.messageRead.createMany({
        data: unread.map((m) => ({ messageId: m.id, userId })),
        skipDuplicates: true,
      });
    }

    const peers = await this.chatPeers(chatId, userId);
    this.realtime.emitToUsers(peers, 'message:read', { chatId, userId, readAt: now });
    return { ok: true };
  }

  // ─────────────── настройки чата ───────────────

  async setTheme(userId: string, chatId: number, theme: string): Promise<OkDto> {
    await this.loadChat(userId, chatId);
    await this.prisma.chat.update({ where: { id: chatId }, data: { theme } });
    const peers = await this.chatPeers(chatId, userId);
    this.realtime.emitToUsers(peers, 'chat:theme', { chatId, theme });
    return { ok: true };
  }

  async setNickname(
    userId: string,
    chatId: number,
    targetUserId: string,
    nickname: string,
  ): Promise<OkDto> {
    await this.loadChat(userId, chatId);
    await this.prisma.chatParticipant.update({
      where: { chatId_userId: { chatId, userId: targetUserId } },
      data: { nickname },
    });
    return { ok: true };
  }

  async setMute(userId: string, chatId: number, muted: boolean): Promise<OkDto> {
    await this.loadChat(userId, chatId);
    await this.prisma.chatParticipant.update({
      where: { chatId_userId: { chatId, userId } },
      data: { isMuted: muted },
    });
    return { ok: true };
  }

  /** «Удалить чат» — выходим сами; когда участников не осталось, чат гибнет каскадом. */
  async deleteChat(userId: string, chatId: number): Promise<OkDto> {
    await this.loadChat(userId, chatId);
    await this.prisma.chatParticipant.delete({
      where: { chatId_userId: { chatId, userId } },
    });
    const left = await this.prisma.chatParticipant.count({ where: { chatId } });
    if (left === 0) await this.prisma.chat.delete({ where: { id: chatId } });
    return { ok: true, message: 'Чат удалён' };
  }

  async report(userId: string, chatId: number, reason: string): Promise<OkDto> {
    await this.loadChat(userId, chatId);
    await this.prisma.report.create({
      data: {
        reporterId: userId,
        targetType: ReportTargetType.CHAT,
        targetId: String(chatId),
        reason,
      },
    });
    return { ok: true, message: 'Жалоба отправлена' };
  }

  // ─────────────── запросы на переписку ───────────────

  async requests(userId: string): Promise<MessageRequestItemDto[]> {
    const rows = await this.prisma.messageRequest.findMany({
      where: { toUserId: userId, status: RequestStatus.PENDING },
      select: {
        id: true,
        chatId: true,
        createdAt: true,
        fromUser: { select: USER_BRIEF },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      rows.map(async (r) => {
        const last = await this.prisma.message.findFirst({
          where: { chatId: r.chatId },
          orderBy: { sentAt: 'desc' },
          select: MESSAGE_SELECT,
        });
        return {
          id: r.id,
          fromUser: this.toBrief(r.fromUser),
          chatId: r.chatId,
          lastMessage: last ? this.toMessage(last, userId) : null,
          createdAt: r.createdAt,
        };
      }),
    );
  }

  async acceptRequest(userId: string, requestId: string): Promise<OkDto> {
    const req = await this.loadOwnRequest(userId, requestId);
    await this.prisma.messageRequest.update({
      where: { id: req.id },
      data: { status: RequestStatus.ACCEPTED, decidedAt: new Date() },
    });
    return { ok: true, message: 'Запрос принят — переписка в основных' };
  }

  async declineRequest(userId: string, requestId: string): Promise<OkDto> {
    const req = await this.loadOwnRequest(userId, requestId);
    // НЕ удаляем строку: @@unique(from,to) + повторная заявка обновит её (антиспам).
    await this.prisma.messageRequest.update({
      where: { id: req.id },
      data: { status: RequestStatus.DECLINED, decidedAt: new Date() },
    });
    return { ok: true, message: 'Запрос отклонён' };
  }

  // ─────────────── звонок ───────────────

  async startCall(userId: string, chatId: number, type: CallType): Promise<CallStartedDto> {
    const { peer } = await this.loadChat(userId, chatId);
    await this.access.assertNotBlocked(userId, peer.id);

    const call = await this.prisma.callSession.create({
      data: { chatId, callerId: userId, type },
      select: { id: true, type: true, status: true },
    });

    // Оповещаем собеседника — дальше SDP/ICE идут через сокет (call:offer и т.д.).
    this.realtime.emitToUsers([peer.id], 'call:incoming', {
      callId: call.id,
      chatId,
      type,
      fromUserId: userId,
    });

    return { callId: call.id, chatId, type: call.type, status: call.status };
  }

  // ─────────────── helpers ───────────────

  private async loadChat(
    userId: string,
    chatId: number,
  ): Promise<{ peer: UserBriefRow; part: { isMuted: boolean; chat: { theme: string } } }> {
    const part = await this.prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: {
        isMuted: true,
        chat: {
          select: {
            theme: true,
            participants: {
              where: { userId: { not: userId } },
              select: { user: { select: USER_BRIEF } },
            },
          },
        },
      },
    });
    if (!part) throw new NotFoundException('Чат не найден');
    const peer = part.chat.participants[0]?.user;
    if (!peer) throw new NotFoundException('Собеседник не найден');
    return { peer, part: { isMuted: part.isMuted, chat: { theme: part.chat.theme } } };
  }

  private async loadMessageInMyChat(
    userId: string,
    messageId: number,
  ): Promise<{ chatId: number }> {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { chatId: true },
    });
    if (!msg) throw new NotFoundException('Сообщение не найдено');
    await this.loadChat(userId, msg.chatId);
    return { chatId: msg.chatId };
  }

  private async loadOwnRequest(userId: string, requestId: string): Promise<{ id: string }> {
    const req = await this.prisma.messageRequest.findUnique({
      where: { id: requestId },
      select: { id: true, toUserId: true, status: true },
    });
    if (!req || req.status !== RequestStatus.PENDING) {
      throw new NotFoundException('Запрос не найден');
    }
    if (req.toUserId !== userId) throw new ForbiddenException('Это не ваш запрос');
    return { id: req.id };
  }

  private async chatPeers(chatId: number, exceptUserId: string): Promise<string[]> {
    const parts = await this.prisma.chatParticipant.findMany({
      where: { chatId, userId: { not: exceptUserId } },
      select: { userId: true },
    });
    return parts.map((p) => p.userId);
  }

  private toMessage(m: MessageRow, viewerId: string): MessageDto {
    return {
      id: m.id,
      chatId: m.chatId,
      senderId: m.senderId,
      text: m.isDeleted ? null : m.text,
      type: m.type,
      mediaUrl: m.isDeleted ? null : m.mediaUrl,
      duration: m.duration,
      replyToId: m.replyToId,
      sharedPostId: m.sharedPostId,
      noteSnapshot: m.noteSnapshot,
      reactions: m.reactions,
      editedAt: m.editedAt,
      isDeleted: m.isDeleted,
      // Прочитано, если собеседник (не я) отметил.
      isRead: m.senderId === viewerId && m.reads.some((r) => r.userId !== viewerId),
      sentAt: m.sentAt,
    };
  }

  private toBrief(u: UserBriefRow): UserBriefDto {
    return {
      id: u.id,
      userName: u.userName,
      fullName: u.fullName,
      avatarUrl: u.profile?.avatarUrl ?? null,
      isVerified: u.isVerified,
      isPrivate: u.isPrivate,
    };
  }
}
