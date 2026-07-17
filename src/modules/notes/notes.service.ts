import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FollowStatus, MsgType, NoteAudience, NotifType, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { ChatUtilService } from '../../common/chat/chat-util.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import { OnlineMusicService } from '../music/online/online-music.service';
import { UserBriefDto } from '../users/dto/users.dto';
import {
  CreateNoteDto,
  NoteDto,
  NoteLikeItemDto,
  NoteLikeToggleDto,
  NoteMusicDto,
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
  textColor: true,
  audience: true,
  createdAt: true,
  expiresAt: true,
  user: { select: USER_BRIEF },
  music: {
    select: {
      id: true,
      title: true,
      artist: true,
      coverUrl: true,
      url: true,
      provider: true,
      externalId: true,
    },
  },
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
    private readonly online: OnlineMusicService,
    private readonly storage: StorageService,
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
        musicId: await this.resolveMusicId(dto),
        bgColor: dto.bgColor ?? null,
        textColor: dto.textColor ?? null,
        audience: dto.audience ?? NoteAudience.FOLLOWERS,
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
    const visibleAuthorIds = authorIds.filter((id) => !hidden.includes(id));

    // Кто из этих авторов держит МЕНЯ в близких друзьях. Только их заметки
    // с audience=CLOSE_FRIENDS мне видны: иначе «близкие друзья» были бы
    // подписью на картинке, а не ограничением доступа.
    const closeTo = await this.prisma.closeFriend.findMany({
      where: { userId: { in: visibleAuthorIds }, friendId: userId },
      select: { userId: true },
    });
    const closeToMe = new Set(closeTo.map((c) => c.userId));

    const rows = await this.prisma.note.findMany({
      where: {
        userId: { in: visibleAuthorIds },
        expiresAt: { gt: new Date() },
        OR: [
          { audience: NoteAudience.FOLLOWERS },
          // Свои заметки вижу всегда, чужие «для близких» — только если я в списке.
          { audience: NoteAudience.CLOSE_FRIENDS, userId: { in: [userId, ...closeToMe] } },
        ],
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
    await this.assertAudience(userId, note);

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
        ...(dto.textColor !== undefined ? { textColor: dto.textColor } : {}),
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

  /**
   * Эмодзи-реакция на заметку → уходит в личку автору (как реакция на историю).
   * Заметка — DM-центричная сущность, отдельной ленты реакций у неё нет: эмодзи
   * это короткий ответ. Переиспользуем reply() — тот же путь в чат + уведомление.
   */
  async reaction(userId: string, id: number, emoji: string): Promise<NoteReplySentDto> {
    return this.reply(userId, id, emoji);
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
      select: { userId: true, text: true, expiresAt: true, audience: true },
    });
    if (!note) throw new NotFoundException('Заметка не найдена');
    if (note.expiresAt <= new Date()) throw new NotFoundException('Заметка истекла');
    await this.access.assertCanViewContent(userId, note.userId);
    await this.assertAudience(userId, note);
    return { userId: note.userId, text: note.text };
  }

  /**
   * Заметка «только для близких друзей» — видна автору и тем, кого он внёс
   * в CloseFriend. Остальным её нет: 404, а не 403.
   *
   * 404 намеренно: 403 «вам нельзя» подтвердил бы, что заметка существует, и
   * посторонний узнал бы о её наличии. Для него её просто не существует.
   *
   * Проверка нужна отдельно от ленты: лента фильтрует список, а сюда приходят
   * по прямому id — like/reply/byId. Без неё «близкие друзья» обходились бы
   * простым перебором id.
   */
  private async assertAudience(
    viewerId: string,
    note: { userId: string; audience: NoteAudience },
  ): Promise<void> {
    if (note.audience !== NoteAudience.CLOSE_FRIENDS) return;
    if (note.userId === viewerId) return;

    const isClose = await this.prisma.closeFriend.findUnique({
      where: { userId_friendId: { userId: note.userId, friendId: viewerId } },
      select: { id: true },
    });
    if (!isClose) throw new NotFoundException('Заметка не найдена');
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

  /**
   * Какой трек прикрепить: наш `musicId` или трек из каталога по
   * `provider`+`externalId` (импортируем — с обложкой и названием). Поставить
   * трек и «сохранить себе» — разные намерения, поэтому в SavedMusic ничего не кладём.
   */
  private async resolveMusicId(dto: CreateNoteDto): Promise<number | null> {
    if (dto.musicId) {
      const row = await this.prisma.music.findUnique({
        where: { id: dto.musicId },
        select: { id: true },
      });
      if (!row) throw new NotFoundException('Трек не найден');
      return row.id;
    }
    if (dto.externalId) {
      if (!dto.provider) {
        throw new BadRequestException(
          'externalId без provider — непонятно, из какого каталога трек',
        );
      }
      return this.online.ensureImported(dto.provider, dto.externalId);
    }
    return null;
  }

  /**
   * Трек заметки. «Играется целиком» определяется наличием файла в нашем S3
   * (`keyFromUrl`), а не происхождением трека: если полный mp3 для трека из
   * Spotify позже зальют через `music:import`, заметка начнёт играть его целиком
   * без правок кода. У чистого Spotify-трека файла нет — там 30-сек preview.
   */
  private toNoteMusic(m: NonNullable<NoteRow['music']>): NoteMusicDto {
    const isFullTrack = this.storage.keyFromUrl(m.url) !== null;
    return {
      id: m.id,
      title: m.title,
      artist: m.artist,
      streamUrl: isFullTrack ? `${this.appUrl}/api/music/${m.id}/stream` : null,
      previewUrl: m.url,
      coverUrl: m.coverUrl,
      provider: m.provider,
      externalId: m.externalId,
      isFullTrack,
    };
  }

  private toDto(row: NoteRow, viewerId: string, isLiked: boolean): NoteDto {
    return {
      id: row.id,
      text: row.text ?? '',
      author: this.toBrief(row.user),
      music: row.music ? this.toNoteMusic(row.music) : null,
      bgColor: row.bgColor,
      textColor: row.textColor,
      audience: row.audience,
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
