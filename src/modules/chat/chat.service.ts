import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CallStatus,
  CallType,
  MsgType,
  Prisma,
  RequestStatus,
  ReportTargetType,
} from '@prisma/client';
import { SpotifyService } from '../spotify/spotify.service';
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
  CallStateDto,
  ChatCreatedDto,
  ChatDetailDto,
  ChatListItemDto,
  CreateGroupChatDto,
  DeletedCountDto,
  GroupCreatedDto,
  IceServerDto,
  IceServersDto,
  MessageDto,
  MessageMusicDto,
  MessageRequestItemDto,
  OkDto,
  SendMessageDto,
} from './dto/chat.dto';
import { EDIT_WINDOW_MS, GROUP_MAX_MEMBERS, GROUP_MIN_INVITES } from './dto/chat.dto';

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
  music: {
    select: {
      id: true,
      title: true,
      artist: true,
      coverUrl: true,
      duration: true,
      url: true,
      spotifyId: true,
    },
  },
  // Строка о звонке (type=CALL) — тип/статус/длительность берём из самого
  // звонка, а не дублируем в тексте сообщения: один источник правды.
  call: { select: { id: true, type: true, status: true, answeredAt: true, endedAt: true } },
} satisfies Prisma.MessageSelect;

const CALL_SELECT = {
  id: true,
  chatId: true,
  callerId: true,
  type: true,
  status: true,
  startedAt: true,
  answeredAt: true,
  endedAt: true,
} satisfies Prisma.CallSessionSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;
type UserBriefRow = Prisma.UserGetPayload<{ select: typeof USER_BRIEF }>;
type CallRow = Prisma.CallSessionGetPayload<{ select: typeof CALL_SELECT }>;

@Injectable()
export class ChatService {
  /** Базовый URL для ссылки на наш стриминг треков (тот же формат, что в MusicService). */
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly chatUtil: ChatUtilService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly validator: FileValidator,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
    private readonly spotify: SpotifyService,
    private readonly config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
  }

  // ─────────────── список и создание ───────────────

  async list(userId: string): Promise<ChatListItemDto[]> {
    const parts = await this.prisma.chatParticipant.findMany({
      // Групповые чаты раньше отсекались прямо здесь (`isGroup: false`) — из-за
      // этого группа не появилась бы в списке, даже если бы её удалось создать.
      where: { userId },
      select: {
        chatId: true,
        nickname: true,
        isMuted: true,
        isAdmin: true,
        lastReadAt: true,
        chat: {
          select: {
            id: true,
            theme: true,
            isGroup: true,
            title: true,
            participants: {
              where: { userId: { not: userId } },
              select: { user: { select: USER_BRIEF } },
              orderBy: { joinedAt: 'asc' },
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

    // Presence считаем только для 1-на-1: у группы «онлайн собеседника» нет.
    const peerIds = parts
      .filter((p) => !p.chat.isGroup)
      .map((p) => p.chat.participants[0]?.user.id)
      .filter((id): id is string => Boolean(id));
    const onlineMap = await this.presence.onlineMap(peerIds);

    const items = await Promise.all(
      parts.map(async (p) => {
        const others = p.chat.participants.map((x) => x.user);
        const isGroup = p.chat.isGroup;
        const peer = isGroup ? null : (others[0] ?? null);
        // 1-на-1 без собеседника (аккаунт удалён) — как и раньше, не показываем.
        if (!isGroup && !peer) return null;
        // Группа, из которой все вышли, кроме меня, — всё равно моя группа.

        const last = p.chat.messages[0] ?? null;
        const unreadCount = await this.prisma.message.count({
          where: {
            chatId: p.chatId,
            senderId: { not: userId },
            isDeleted: false,
            ...(p.lastReadAt ? { sentAt: { gt: p.lastReadAt } } : {}),
          },
        });

        const online = peer ? (onlineMap.get(peer.id) ?? false) : false;
        const item: ChatListItemDto = {
          id: p.chatId,
          isGroup,
          title: p.chat.title,
          peer: peer ? this.toBrief(peer) : null,
          participants: others.map((u) => this.toBrief(u)),
          participantsCount: others.length + 1, // +1 — я сам
          isAdmin: p.isAdmin,
          peerNickname: p.nickname,
          theme: p.chat.theme,
          isMuted: p.isMuted,
          lastMessage: last ? this.toMessage(last, userId) : null,
          lastMessageAt: last?.sentAt ?? null,
          unreadCount,
          isOnline: online,
          lastSeenAt: peer && !online ? await this.presence.lastSeen(peer.id) : null,
        };
        return item;
      }),
    );

    return items
      .filter((i): i is ChatListItemDto => i !== null)
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  }

  // ─────────────── групповые чаты ───────────────

  /**
   * Создать группу. Создатель — админ (единственный, кто может удалять).
   *
   * Группа НЕ идемпотентна, в отличие от 1-на-1: две группы с одним составом —
   * это две разные группы (в IG так же), поэтому существующую не переиспользуем.
   */
  async createGroup(userId: string, dto: CreateGroupChatDto): Promise<GroupCreatedDto> {
    const invited = [...new Set(dto.userIds)].filter((id) => id !== userId);
    if (invited.length < GROUP_MIN_INVITES) {
      throw new BadRequestException(
        `Для группы нужно минимум ${GROUP_MIN_INVITES} собеседника — иначе это обычный чат 1-на-1`,
      );
    }
    if (invited.length + 1 > GROUP_MAX_MEMBERS) {
      throw new BadRequestException(`В группе максимум ${GROUP_MAX_MEMBERS} участников`);
    }

    await this.assertUsersAddable(userId, invited);

    const chat = await this.prisma.chat.create({
      data: {
        isGroup: true,
        title: dto.title?.trim() || null,
        participants: {
          create: [{ userId, isAdmin: true }, ...invited.map((id) => ({ userId: id }))],
        },
      },
      select: { id: true, title: true },
    });

    const me = await this.userName(userId);
    await this.systemMessage(chat.id, userId, `${me} создал(а) группу`);

    // Группа должна появиться у всех сразу, а не после перезагрузки списка.
    this.realtime.emitToUsers(invited, 'chat:group-created', {
      chatId: chat.id,
      title: chat.title,
    });

    return {
      id: chat.id,
      isGroup: true,
      title: chat.title,
      participantsCount: invited.length + 1,
    };
  }

  /** Добавлять может ЛЮБОЙ участник группы (как в IG). */
  async addParticipants(userId: string, chatId: number, userIds: string[]): Promise<OkDto> {
    const { isGroup, others } = await this.loadChat(userId, chatId);
    if (!isGroup) throw new BadRequestException('Это не групповой чат');

    const current = new Set([userId, ...others.map((o) => o.id)]);
    const toAdd = [...new Set(userIds)].filter((id) => !current.has(id));
    if (toAdd.length === 0) throw new BadRequestException('Все уже в группе');
    if (current.size + toAdd.length > GROUP_MAX_MEMBERS) {
      throw new BadRequestException(`В группе максимум ${GROUP_MAX_MEMBERS} участников`);
    }

    await this.assertUsersAddable(userId, toAdd);

    await this.prisma.chatParticipant.createMany({
      data: toAdd.map((id) => ({ chatId, userId: id })),
      skipDuplicates: true,
    });

    const me = await this.userName(userId);
    const names = await this.userNames(toAdd);
    await this.systemMessage(chatId, userId, `${me} добавил(а): ${names.join(', ')}`);

    this.realtime.emitToUsers([...current, ...toAdd], 'chat:participants-added', {
      chatId,
      userIds: toAdd,
    });
    return { ok: true, message: `Добавлено: ${toAdd.length}` };
  }

  /** Удалять — только админ (решение пользователя). Себя удалять нельзя: для этого leave. */
  async removeParticipant(userId: string, chatId: number, targetId: string): Promise<OkDto> {
    const { isGroup, isAdmin, others } = await this.loadChat(userId, chatId);
    if (!isGroup) throw new BadRequestException('Это не групповой чат');
    if (!isAdmin) throw new ForbiddenException('Удалять участников может только админ группы');
    if (targetId === userId) {
      throw new BadRequestException('Себя удалить нельзя — выйдите из группы');
    }
    if (!others.some((o) => o.id === targetId)) {
      throw new NotFoundException('Участник не найден в этой группе');
    }

    await this.prisma.chatParticipant.delete({
      where: { chatId_userId: { chatId, userId: targetId } },
    });

    const me = await this.userName(userId);
    const [name] = await this.userNames([targetId]);
    await this.systemMessage(chatId, userId, `${me} удалил(а) ${name}`);

    this.realtime.emitToUsers([userId, ...others.map((o) => o.id)], 'chat:participant-removed', {
      chatId,
      userId: targetId,
    });
    return { ok: true, message: 'Участник удалён' };
  }

  /**
   * Выйти из группы может любой.
   *
   * Если вышел админ — админом становится самый давний из оставшихся: иначе
   * группа осталась бы навсегда без того, кто может удалять участников.
   * Последний участник вышел — группа удаляется целиком (переписка ничья).
   */
  async leaveGroup(userId: string, chatId: number): Promise<OkDto> {
    const { isGroup, isAdmin, others } = await this.loadChat(userId, chatId);
    if (!isGroup) throw new BadRequestException('Это не групповой чат');

    await this.prisma.chatParticipant.delete({
      where: { chatId_userId: { chatId, userId } },
    });

    if (others.length === 0) {
      await this.prisma.chat.delete({ where: { id: chatId } });
      return { ok: true, message: 'Вы вышли, группа удалена' };
    }

    if (isAdmin) {
      const next = await this.prisma.chatParticipant.findFirst({
        where: { chatId },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true },
      });
      if (next) {
        await this.prisma.chatParticipant.update({
          where: { chatId_userId: { chatId, userId: next.userId } },
          data: { isAdmin: true },
        });
      }
    }

    const me = await this.userName(userId);
    await this.systemMessage(chatId, userId, `${me} вышел(ла) из группы`);

    this.realtime.emitToUsers(
      others.map((o) => o.id),
      'chat:participant-left',
      { chatId, userId },
    );
    return { ok: true, message: 'Вы вышли из группы' };
  }

  /** Переименовать группу может любой участник (как в IG). */
  async updateGroupTitle(userId: string, chatId: number, title: string): Promise<OkDto> {
    const { isGroup, others } = await this.loadChat(userId, chatId);
    if (!isGroup) throw new BadRequestException('Переименовать можно только группу');

    await this.prisma.chat.update({ where: { id: chatId }, data: { title: title.trim() } });

    const me = await this.userName(userId);
    await this.systemMessage(chatId, userId, `${me} переименовал(а) группу: «${title.trim()}»`);

    this.realtime.emitToUsers(
      others.map((o) => o.id),
      'chat:group-renamed',
      { chatId, title: title.trim() },
    );
    return { ok: true, message: 'Название обновлено' };
  }

  // ─── вспомогательное для групп ───

  /**
   * Кого вообще можно добавлять: живой аккаунт и нет взаимной блокировки.
   * Блок проверяем только с тем, КТО добавляет: остальные участники сами
   * разберутся со своими блокировками (в IG добавление тоже не спрашивает
   * разрешения у всей группы).
   */
  private async assertUsersAddable(actorId: string, userIds: string[]): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isDeleted: false },
      select: { id: true },
    });
    if (users.length !== userIds.length) {
      throw new NotFoundException('Пользователь не найден');
    }
    for (const id of userIds) {
      await this.access.assertNotBlocked(actorId, id);
    }
  }

  /** Служебная строка в ленте сообщений: «X добавил(а) Y». */
  private async systemMessage(chatId: number, actorId: string, text: string): Promise<void> {
    const message = await this.prisma.message.create({
      data: { chatId, senderId: actorId, text, type: MsgType.SYSTEM },
      select: MESSAGE_SELECT,
    });
    const peers = await this.chatPeers(chatId, actorId);
    this.realtime.emitToUsers(peers, 'message:new', this.toMessage(message, actorId));
  }

  private async userName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { userName: true },
    });
    return u?.userName ?? 'Пользователь';
  }

  private async userNames(userIds: string[]): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { userName: true },
    });
    return rows.map((r) => r.userName);
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
    const { peer, otherParts, isGroup, title, isAdmin, part } = await this.loadChat(userId, chatId);

    // Присутствие всех участников — ОДНИМ запросом в Redis (onlineMap), а не по
    // одному на человека: в группе на 32 человека это было бы 32 похода подряд.
    const ids = otherParts.map((p) => p.user.id);
    const onlineMap = await this.presence.onlineMap(ids);

    const participants = await Promise.all(
      otherParts.map(async (p) => {
        const isOnline = onlineMap.get(p.user.id) ?? false;
        return {
          ...this.toBrief(p.user),
          nickname: p.nickname,
          isAdmin: p.isAdmin,
          isOnline,
          // «был(а) в сети …» нужен только для тех, кто сейчас офлайн.
          lastSeenAt: isOnline ? null : await this.presence.lastSeen(p.user.id),
        };
      }),
    );

    const online = peer ? (onlineMap.get(peer.id) ?? false) : false;
    return {
      id: chatId,
      isGroup,
      title,
      peer: peer ? this.toBrief(peer) : null,
      participants,
      participantsCount: otherParts.length + 1,
      isAdmin,
      theme: part.chat.theme,
      isMuted: part.isMuted,
      isOnline: online,
      lastSeenAt: peer && !online ? await this.presence.lastSeen(peer.id) : null,
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
    // Блокировка — понятие пары. В группе блок одного участника не должен
    // затыкать весь чат остальным, поэтому проверяем только 1-на-1.
    if (peer) await this.access.assertNotBlocked(userId, peer.id);

    let type: MsgType = MsgType.TEXT;
    let mediaUrl: string | null = null;
    let duration: number | null = null;
    let musicId: number | null = null;

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
    } else if (dto.musicId || dto.spotifyId) {
      type = MsgType.MUSIC_SHARE;
      musicId = await this.resolveMusicId(dto);
    } else if (!dto.text?.trim()) {
      throw new BadRequestException('Пустое сообщение: нужен text, файл, стикер, пост или трек');
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
        musicId,
      },
      select: MESSAGE_SELECT,
    });

    const dtoOut = this.toMessage(message, userId);
    // Доставка ВСЕМ участникам, а не одному собеседнику: в группе из пяти
    // человек прежний `[peer.id]` доставлял сообщение ровно одному, остальные
    // увидели бы его только после перезагрузки чата.
    this.realtime.emitToUsers(await this.chatPeers(chatId, userId), 'message:new', dtoOut);
    return dtoOut;
  }

  /**
   * Какой Music.id прикрепить к сообщению.
   *
   * `musicId` — трек уже в нашей библиотеке. `spotifyId` — трека у нас может не
   * быть: тащим его из Spotify (upsert, повтор не плодит строки). Импорт НЕ
   * добавляет трек в «сохранённые» отправителя — поделиться и сохранить это
   * разные вещи.
   */
  private async resolveMusicId(dto: SendMessageDto): Promise<number> {
    if (dto.musicId) {
      const row = await this.prisma.music.findUnique({
        where: { id: dto.musicId },
        select: { id: true },
      });
      if (!row) throw new NotFoundException('Трек не найден');
      return row.id;
    }
    return this.spotify.ensureImported(dto.spotifyId as string);
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
    const { peer, others } = await this.loadChat(userId, chatId);
    // Блок — понятие пары: проверяем только в 1-на-1 (в группе звоним всем).
    if (peer) await this.access.assertNotBlocked(userId, peer.id);

    const call = await this.prisma.callSession.create({
      data: { chatId, callerId: userId, type },
      select: { id: true, type: true, status: true },
    });

    // Звоним ВСЕМ участникам: в группе звонок должен звенеть у каждого, а не у
    // одного. Дальше SDP/ICE идут через сокет (call:offer и т.д.) — сигналинг
    // уже рассылается по всем участникам чата.
    this.realtime.emitToUsers(
      others.map((o) => o.id),
      'call:incoming',
      {
        callId: call.id,
        chatId,
        type,
        fromUserId: userId,
      },
    );

    return { callId: call.id, chatId, type: call.type, status: call.status };
  }

  /**
   * Взять трубку. Длительность считается от `answeredAt`, а не от `startedAt`:
   * время, пока телефон звонил, разговором не является.
   */
  async answerCall(userId: string, callId: string): Promise<CallStateDto> {
    const call = await this.loadCallForParticipant(userId, callId);
    if (call.callerId === userId) {
      throw new BadRequestException('Нельзя ответить на собственный звонок');
    }
    if (call.status !== CallStatus.RINGING) {
      throw new BadRequestException(`Звонок уже не звонит (${call.status})`);
    }

    const updated = await this.prisma.callSession.update({
      where: { id: callId },
      data: { status: CallStatus.ONGOING, answeredAt: new Date() },
      select: CALL_SELECT,
    });

    // Всем участникам, включая звонящего: у него должно погаснуть «идёт вызов»,
    // а на других устройствах ответившего — исчезнуть входящий.
    this.realtime.emitToUsers(await this.callAudience(call.chatId, null), 'call:answered', {
      callId,
      chatId: call.chatId,
      byUserId: userId,
    });
    return this.toCallState(updated);
  }

  /** Отклонить (нажать «сбросить»). Звонившему — call:declined, в чат — строка. */
  async declineCall(userId: string, callId: string): Promise<CallStateDto> {
    const call = await this.loadCallForParticipant(userId, callId);
    if (call.callerId === userId) {
      throw new BadRequestException('Свой звонок нужно завершать, а не отклонять');
    }
    if (call.status !== CallStatus.RINGING) {
      throw new BadRequestException(`Звонок уже не звонит (${call.status})`);
    }

    const updated = await this.prisma.callSession.update({
      where: { id: callId },
      data: { status: CallStatus.DECLINED, endedAt: new Date() },
      select: CALL_SELECT,
    });
    await this.callMessage(call.chatId, call.callerId, callId);

    this.realtime.emitToUsers(await this.callAudience(call.chatId, null), 'call:declined', {
      callId,
      chatId: call.chatId,
      byUserId: userId,
    });
    return this.toCallState(updated);
  }

  /**
   * Завершить звонок. Может любой участник.
   *
   * Ключевая развилка: если трубку так и не взяли (status ещё RINGING), это
   * **MISSED**, а не ENDED — иначе пропущенный звонок выглядел бы в истории как
   * разговор длиной ноль секунд, и «пропущенных» не существовало бы вовсе.
   */
  async endCall(userId: string, callId: string): Promise<CallStateDto> {
    const call = await this.loadCallForParticipant(userId, callId);
    if (call.status === CallStatus.ENDED || call.status === CallStatus.MISSED) {
      // Идемпотентно: обе стороны часто шлют «end» одновременно.
      return this.toCallState(await this.loadCall(callId));
    }
    if (call.status === CallStatus.DECLINED) return this.toCallState(await this.loadCall(callId));

    const missed = call.status === CallStatus.RINGING;
    const updated = await this.prisma.callSession.update({
      where: { id: callId },
      data: {
        status: missed ? CallStatus.MISSED : CallStatus.ENDED,
        endedAt: new Date(),
      },
      select: CALL_SELECT,
    });
    await this.callMessage(call.chatId, call.callerId, callId);

    this.realtime.emitToUsers(await this.callAudience(call.chatId, null), 'call:ended', {
      callId,
      chatId: call.chatId,
      byUserId: userId,
      status: updated.status,
    });
    return this.toCallState(updated);
  }

  /** История звонков чата (в IG она же — строки в переписке). */
  async calls(userId: string, chatId: number, dto: CursorDto): Promise<CursorPage<CallStateDto>> {
    await this.loadChat(userId, chatId);
    const rows = await this.prisma.callSession.findMany({
      where: { chatId },
      select: CALL_SELECT,
      orderBy: { startedAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });
    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return { ...page, items: page.items.map((c) => this.toCallState(c)) };
  }

  /**
   * ICE-серверы для WebRTC. Без TURN звонок разваливается, как только оба
   * абонента за NAT (мобильные сети, симметричный NAT — большинство реальных
   * случаев): STUN лишь подсказывает внешний адрес, а ретранслировать трафик
   * умеет только TURN. Держим список на сервере, а не в коде фронта, чтобы
   * менять учётки TURN без пересборки клиента.
   *
   * Учётки TURN — «долгоживущие» из .env. Если TURN не настроен, честно отдаём
   * только STUN: пусть фронт знает, что звонок между NAT'ами может не собраться.
   */
  iceServers(): IceServersDto {
    const stun = (this.config.get<string>('STUN_URLS') ?? 'stun:stun.l.google.com:19302')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);

    const servers: IceServerDto[] = [{ urls: stun }];

    const turnUrls = (this.config.get<string>('TURN_URLS') ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    const username = this.config.get<string>('TURN_USERNAME');
    const credential = this.config.get<string>('TURN_PASSWORD');

    if (turnUrls.length > 0 && username && credential) {
      servers.push({ urls: turnUrls, username, credential });
    }

    return { iceServers: servers, hasTurn: turnUrls.length > 0 && !!username && !!credential };
  }

  // ─── вспомогательное для звонков ───

  private async loadCall(callId: string): Promise<CallRow> {
    const call = await this.prisma.callSession.findUnique({
      where: { id: callId },
      select: CALL_SELECT,
    });
    if (!call) throw new NotFoundException('Звонок не найден');
    return call;
  }

  /** Звонок + проверка, что я вообще в этом чате (иначе чужой звонок можно было бы сбросить). */
  private async loadCallForParticipant(userId: string, callId: string): Promise<CallRow> {
    const call = await this.loadCall(callId);
    await this.loadChat(userId, call.chatId);
    return call;
  }

  private async callAudience(chatId: number, exceptUserId: string | null): Promise<string[]> {
    const parts = await this.prisma.chatParticipant.findMany({
      where: { chatId, ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) },
      select: { userId: true },
    });
    return parts.map((p) => p.userId);
  }

  /** Строка о звонке в переписке — как в IG («Аудиозвонок, 5:32» / «Пропущенный»). */
  private async callMessage(chatId: number, callerId: string, callId: string): Promise<void> {
    const message = await this.prisma.message.create({
      data: { chatId, senderId: callerId, type: MsgType.CALL, callId },
      select: MESSAGE_SELECT,
    });
    this.realtime.emitToUsers(
      await this.callAudience(chatId, null),
      'message:new',
      this.toMessage(message, callerId),
    );
  }

  private toCallState(c: CallRow): CallStateDto {
    return {
      callId: c.id,
      chatId: c.chatId,
      callerId: c.callerId,
      type: c.type,
      status: c.status,
      startedAt: c.startedAt,
      answeredAt: c.answeredAt,
      endedAt: c.endedAt,
      durationSec: this.callDuration(c),
    };
  }

  /** Разговор — от «взяли трубку» до «положили». Не дозвонились → 0. */
  private callDuration(c: { answeredAt: Date | null; endedAt: Date | null }): number {
    if (!c.answeredAt || !c.endedAt) return 0;
    return Math.max(0, Math.round((c.endedAt.getTime() - c.answeredAt.getTime()) / 1000));
  }

  // ─────────────── helpers ───────────────

  /**
   * Чат, в котором я состою. Одна дверь и для 1-на-1, и для группы.
   *
   * `peer` есть только у 1-на-1 — в группе «собеседника» не существует, там
   * `others`. Раньше метод жёстко требовал peer и падал «Собеседник не найден»,
   * из-за чего групповой чат был невозможен в принципе.
   */
  private async loadChat(
    userId: string,
    chatId: number,
  ): Promise<{
    isGroup: boolean;
    title: string | null;
    peer: UserBriefRow | null;
    others: UserBriefRow[];
    otherParts: { nickname: string | null; isAdmin: boolean; user: UserBriefRow }[];
    isAdmin: boolean;
    part: { isMuted: boolean; chat: { theme: string } };
  }> {
    const part = await this.prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: {
        isMuted: true,
        isAdmin: true,
        chat: {
          select: {
            theme: true,
            isGroup: true,
            title: true,
            participants: {
              where: { userId: { not: userId } },
              select: { nickname: true, isAdmin: true, user: { select: USER_BRIEF } },
              orderBy: { joinedAt: 'asc' },
            },
          },
        },
      },
    });
    if (!part) throw new NotFoundException('Чат не найден');

    const otherParts = part.chat.participants;
    const others = otherParts.map((p) => p.user);
    const isGroup = part.chat.isGroup;
    // В 1-на-1 без собеседника делать нечего (аккаунт удалён) — это 404, как и было.
    if (!isGroup && others.length === 0) throw new NotFoundException('Собеседник не найден');

    return {
      isGroup,
      title: part.chat.title,
      peer: isGroup ? null : others[0],
      others,
      otherParts,
      isAdmin: part.isAdmin,
      part: { isMuted: part.isMuted, chat: { theme: part.chat.theme } },
    };
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
      music: m.isDeleted ? null : this.toMessageMusic(m.music),
      call: m.call
        ? {
            id: m.call.id,
            type: m.call.type,
            status: m.call.status,
            durationSec: this.callDuration(m.call),
          }
        : null,
      reactions: m.reactions,
      editedAt: m.editedAt,
      isDeleted: m.isDeleted,
      // Прочитано, если собеседник (не я) отметил.
      isRead: m.senderId === viewerId && m.reads.some((r) => r.userId !== viewerId),
      sentAt: m.sentAt,
    };
  }

  /**
   * Трек в сообщении. Честно разделяем «играется целиком» и «только превью».
   *
   * Признак — НЕ происхождение трека, а есть ли у нас сам файл:
   * `keyFromUrl` возвращает ключ, только если url указывает в наш S3. Спервоначала
   * тут стояло `spotifyId === null`, и это было неверно: трек, пришедший из Spotify,
   * но чей полный mp3 позже залили через `npm run music:import` (upsert по
   * spotifyId переписывает url на ключ S3), продолжал бы отдаваться как
   * «30 секунд», хотя файл уже лежит. Теперь такой трек играет целиком сам собой.
   */
  private toMessageMusic(m: MessageRow['music']): MessageMusicDto | null {
    if (!m) return null;
    const isFullTrack = this.storage.keyFromUrl(m.url) !== null;
    return {
      id: m.id,
      title: m.title,
      artist: m.artist,
      coverUrl: m.coverUrl,
      duration: m.duration,
      streamUrl: isFullTrack ? `${this.appUrl}/api/music/${m.id}/stream` : null,
      previewUrl: m.url,
      spotifyId: m.spotifyId,
      isFullTrack,
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
