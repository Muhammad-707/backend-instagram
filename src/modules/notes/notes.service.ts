import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FollowStatus, MsgType, NotifType, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { ChatUtilService } from '../../common/chat/chat-util.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import { UserBriefDto } from '../users/dto/users.dto';
import {
  CreateNoteDto,
  NoteDto,
  NoteLikeItemDto,
  NoteLikeToggleDto,
  NoteReplyItemDto,
  NoteReplySentDto,
  UpdateNoteDto,
} from './dto/note.dto';

/** Заметка живёт 24ч (ТЗ §5.8). */
const NOTE_TTL_MS = 24 * 60 * 60 * 1000;
/** Длина превью в noteSnapshot — как text заметки (60). */
const SNAPSHOT_MAX = 60;

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

const NOTE_SELECT = {
  id: true,
  userId: true,
  text: true,
  bgColor: true,
  createdAt: true,
  expiresAt: true,
  user: { select: USER_BRIEF },
  music: { select: { id: true, title: true, artist: true, coverUrl: true } },
  _count: { select: { likes: true } },
} satisfies Prisma.NoteSelect;

type NoteRow = Prisma.NoteGetPayload<{ select: typeof NOTE_SELECT }>;
type UserBriefRow = Prisma.UserGetPayload<{ select: typeof USER_BRIEF }>;

@Injectable()
export class NotesService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly chat: ChatUtilService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
  }

  // ─────────────── CRUD ───────────────

  /** Одна активная заметка на юзера — новая заменяет прежнюю (как в IG). */
  async create(userId: string, dto: CreateNoteDto): Promise<NoteDto> {
    // Прежние (в т.ч. неистёкшие) заметки убираем: в IG у профиля висит ровно одна.
    await this.prisma.note.deleteMany({ where: { userId } });

    const note = await this.prisma.note.create({
      data: {
        userId,
        text: dto.text,
        musicId: dto.musicId ?? null,
        bgColor: dto.bgColor ?? null,
        expiresAt: new Date(Date.now() + NOTE_TTL_MS),
      },
      select: { id: true },
    });
    return this.byId(userId, note.id);
  }

  /**
   * Лента заметок: мои + подписок, только неистёкшие. Заблокированные исключены.
   * Заметки закрытых аккаунтов вижу, только если подписан (то же правило, что и контент).
   */
  async feed(userId: string): Promise<NoteDto[]> {
    const following = await this.prisma.follow.findMany({
      where: { followerId: userId, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
    });
    const authorIds = [...following.map((f) => f.followingId), userId];
    const hidden = await this.access.blockedIds(userId);

    const rows = await this.prisma.note.findMany({
      where: {
        userId: { in: authorIds.filter((id) => !hidden.includes(id)) },
        expiresAt: { gt: new Date() },
      },
      select: NOTE_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    const liked = await this.likedIds(
      userId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => this.toDto(r, userId, liked.has(r.id)));
  }

  async byId(userId: string, id: number): Promise<NoteDto> {
    const note = await this.prisma.note.findUnique({ where: { id }, select: NOTE_SELECT });
    if (!note) throw new NotFoundException('Заметка не найдена');
    await this.access.assertCanViewContent(userId, note.userId);

    const liked = await this.prisma.noteLike.findUnique({
      where: { noteId_userId: { noteId: id, userId } },
      select: { id: true },
    });
    return this.toDto(note, userId, liked !== null);
  }

  async update(userId: string, id: number, dto: UpdateNoteDto): Promise<NoteDto> {
    await this.assertOwner(userId, id);
    await this.prisma.note.update({
      where: { id },
      data: {
        ...(dto.text !== undefined ? { text: dto.text } : {}),
        ...(dto.musicId !== undefined ? { musicId: dto.musicId } : {}),
        ...(dto.bgColor !== undefined ? { bgColor: dto.bgColor } : {}),
      },
    });
    return this.byId(userId, id);
  }

  async remove(userId: string, id: number): Promise<{ deleted: boolean }> {
    await this.assertOwner(userId, id);
    await this.prisma.note.delete({ where: { id } });
    return { deleted: true };
  }

  // ─────────────── лайки ───────────────

  async toggleLike(userId: string, id: number): Promise<NoteLikeToggleDto> {
    const note = await this.loadVisible(userId, id);

    const existing = await this.prisma.noteLike.findUnique({
      where: { noteId_userId: { noteId: id, userId } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.noteLike.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.noteLike.create({ data: { noteId: id, userId } });
      this.notify(note.userId, userId, NotifType.LIKE_NOTE, id);
    }

    const likesCount = await this.prisma.noteLike.count({ where: { noteId: id } });
    return { liked: !existing, likesCount };
  }

  /** Список профилей, кто лайкнул — ТОЛЬКО автору заметки. */
  async likes(userId: string, id: number): Promise<NoteLikeItemDto[]> {
    const note = await this.prisma.note.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!note) throw new NotFoundException('Заметка не найдена');
    if (note.userId !== userId) {
      throw new ForbiddenException('Список лайкнувших виден только автору');
    }

    const rows = await this.prisma.noteLike.findMany({
      where: { noteId: id },
      select: { createdAt: true, user: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({ user: this.toBrief(r.user), likedAt: r.createdAt }));
  }

  // ─────────────── ответы → в чат ───────────────

  /**
   * Ответ на заметку → сообщение в личный чат автора.
   * noteSnapshot ОБЯЗАТЕЛЕН: заметка умрёт через 24ч, а сообщение в чате останется навсегда —
   * без снимка текста превью «в ответ на заметку …» сломалось бы.
   */
  async reply(userId: string, id: number, text: string): Promise<NoteReplySentDto> {
    const note = await this.loadVisible(userId, id);
    if (note.userId === userId) {
      throw new BadRequestException('Нельзя ответить на свою заметку');
    }

    const chat = await this.chat.findOrCreateDirectChat(userId, note.userId);
    const snapshot = (note.text ?? '').slice(0, SNAPSHOT_MAX);

    const message = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        senderId: userId,
        type: MsgType.NOTE_REPLY,
        text,
        noteId: id,
        noteSnapshot: snapshot,
      },
      select: { id: true },
    });

    await this.prisma.noteReply.create({
      data: { noteId: id, userId, text, messageId: message.id },
    });
    this.notify(note.userId, userId, NotifType.REPLY_NOTE, id);

    return { sent: true, chatId: chat.id, messageId: message.id };
  }

  /** Ответы на заметку — ТОЛЬКО автору. */
  async replies(userId: string, id: number): Promise<NoteReplyItemDto[]> {
    const note = await this.prisma.note.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!note) throw new NotFoundException('Заметка не найдена');
    if (note.userId !== userId) {
      throw new ForbiddenException('Ответы видны только автору');
    }

    const rows = await this.prisma.noteReply.findMany({
      where: { noteId: id },
      select: { id: true, text: true, createdAt: true, user: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      author: this.toBrief(r.user),
      createdAt: r.createdAt,
    }));
  }

  // ─────────────── helpers ───────────────

  private async loadVisible(
    userId: string,
    id: number,
  ): Promise<{ userId: string; text: string | null }> {
    const note = await this.prisma.note.findUnique({
      where: { id },
      select: { userId: true, text: true, expiresAt: true },
    });
    if (!note) throw new NotFoundException('Заметка не найдена');
    if (note.expiresAt <= new Date()) throw new NotFoundException('Заметка истекла');
    await this.access.assertCanViewContent(userId, note.userId);
    return { userId: note.userId, text: note.text };
  }

  private async assertOwner(userId: string, id: number): Promise<void> {
    const note = await this.prisma.note.findUnique({ where: { id }, select: { userId: true } });
    if (!note) throw new NotFoundException('Заметка не найдена');
    if (note.userId !== userId) throw new ForbiddenException('Это не ваша заметка');
  }

  private async likedIds(userId: string, noteIds: number[]): Promise<Set<number>> {
    if (noteIds.length === 0) return new Set();
    const rows = await this.prisma.noteLike.findMany({
      where: { userId, noteId: { in: noteIds } },
      select: { noteId: true },
    });
    return new Set(rows.map((r) => r.noteId));
  }

  private notify(userId: string, actorId: string, type: NotifType, noteId: number): void {
    this.events.emit(NOTIFY_EVENT, { userId, actorId, type, noteId } satisfies NotifyPayload);
  }

  private toDto(row: NoteRow, viewerId: string, isLiked: boolean): NoteDto {
    return {
      id: row.id,
      text: row.text ?? '',
      author: this.toBrief(row.user),
      music: row.music
        ? {
            id: row.music.id,
            title: row.music.title,
            artist: row.music.artist,
            streamUrl: `${this.appUrl}/api/music/${row.music.id}/stream`,
            coverUrl: row.music.coverUrl,
          }
        : null,
      bgColor: row.bgColor,
      likesCount: row._count.likes,
      isLiked,
      isMine: row.userId === viewerId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
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
