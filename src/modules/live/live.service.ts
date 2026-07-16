import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FollowStatus, JoinStatus, LiveStatus, NotifType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AccessService } from '../../common/access/access.service';
import { buildCursorPage, CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import { UserBriefDto } from '../users/dto/users.dto';
import {
  AudioDto,
  CameraDto,
  JoinRequestDto,
  LiveCommentDto,
  LiveCommentInputDto,
  LiveDto,
  LiveLikeResultDto,
  LiveOkDto,
  LiveReactionInputDto,
  LiveStatsDto,
  LiveTokenDto,
  LiveViewerDto,
  StartLiveDto,
} from './dto/live.dto';
import { LiveKitService } from './livekit/livekit.service';
import { LiveRealtimeService } from './live-realtime.service';

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

const LIVE_SELECT = {
  id: true,
  hostId: true,
  roomName: true,
  title: true,
  status: true,
  isCameraOn: true,
  isAudioOn: true,
  coverUrl: true,
  viewersCount: true,
  likesCount: true,
  peakViewers: true,
  totalViewers: true,
  startedAt: true,
  endedAt: true,
  host: { select: USER_BRIEF },
} satisfies Prisma.LiveSelect;

type LiveRow = Prisma.LiveGetPayload<{ select: typeof LIVE_SELECT }>;
type UserBriefRow = Prisma.UserGetPayload<{ select: typeof USER_BRIEF }>;

@Injectable()
export class LiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly livekit: LiveKitService,
    private readonly rt: LiveRealtimeService,
    private readonly events: EventEmitter2,
  ) {}

  // ─────────────── старт / стоп ───────────────

  async start(hostId: string, dto: StartLiveDto): Promise<LiveTokenDto> {
    const active = await this.prisma.live.findFirst({
      where: { hostId, status: LiveStatus.LIVE },
      select: { id: true },
    });
    if (active) throw new BadRequestException('У вас уже идёт эфир');

    const roomName = `live-${randomUUID()}`;
    const live = await this.prisma.live.create({
      data: { hostId, roomName, title: dto.title ?? null, coverUrl: dto.coverUrl ?? null },
      select: LIVE_SELECT,
    });

    const token = await this.livekit.createPublisherToken(roomName, hostId, live.host.userName);

    // Подписчикам — эфир в рейле историй + уведомление LIVE_STARTED.
    const followers = await this.prisma.follow.findMany({
      where: { followingId: hostId, status: FollowStatus.ACCEPTED },
      select: { followerId: true },
    });
    for (const f of followers) {
      this.rt.emitToUser(f.followerId, 'live:started', { live: this.toDto(live) });
      this.notify(f.followerId, hostId, NotifType.LIVE_STARTED, live.id);
    }

    return { live: this.toDto(live), token, wsUrl: this.livekit.url };
  }

  async end(hostId: string, liveId: string): Promise<LiveStatsDto> {
    const live = await this.getRaw(liveId);
    this.assertHost(live, hostId);
    if (live.status === LiveStatus.ENDED) throw new BadRequestException('Эфир уже завершён');

    await this.prisma.liveViewer.updateMany({
      where: { liveId, leftAt: null },
      data: { leftAt: new Date() },
    });
    await this.prisma.live.update({
      where: { id: liveId },
      data: { status: LiveStatus.ENDED, endedAt: new Date(), viewersCount: 0 },
    });
    await this.livekit.closeRoom(live.roomName);
    this.rt.emitToLive(liveId, 'live:ended', { liveId });

    return this.stats(liveId);
  }

  // ─────────────── чтение ───────────────

  /** Активные эфиры тех, на кого я подписан (рейл историй, «В ЭФИРЕ»). */
  async feed(userId: string): Promise<LiveDto[]> {
    const rows = await this.prisma.live.findMany({
      where: {
        status: LiveStatus.LIVE,
        host: {
          followers: { some: { followerId: userId, status: FollowStatus.ACCEPTED } },
        },
      },
      select: LIVE_SELECT,
      orderBy: { startedAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async getOne(userId: string, liveId: string): Promise<LiveDto> {
    const live = await this.getRaw(liveId);
    await this.assertCanView(userId, live);
    return this.toDto(live);
  }

  /** Эфир конкретного юзера — «профиль → В эфире» (для НЕ подписчиков через поиск). */
  async getUserLive(userId: string, targetUserId: string): Promise<LiveDto | null> {
    const live = await this.prisma.live.findFirst({
      where: { hostId: targetUserId, status: LiveStatus.LIVE },
      select: LIVE_SELECT,
    });
    if (!live) return null;
    await this.assertCanView(userId, live);
    return this.toDto(live);
  }

  async viewers(userId: string, liveId: string): Promise<LiveViewerDto[]> {
    const live = await this.getRaw(liveId);
    await this.assertCanView(userId, live);
    const rows = await this.prisma.liveViewer.findMany({
      where: { liveId, leftAt: null },
      select: { joinedAt: true, user: { select: USER_BRIEF } },
      orderBy: { joinedAt: 'desc' },
    });
    return rows.map((r) => ({ user: this.toBrief(r.user), joinedAt: r.joinedAt }));
  }

  // ─────────────── зрители ───────────────

  async join(userId: string, liveId: string): Promise<LiveTokenDto> {
    const live = await this.getRaw(liveId);
    if (live.status === LiveStatus.ENDED) throw new BadRequestException('Эфир завершён');
    await this.assertCanView(userId, live);

    const existing = await this.prisma.liveViewer.findFirst({
      where: { liveId, userId, leftAt: null },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.liveViewer.create({ data: { liveId, userId } });
      await this.prisma.live.update({
        where: { id: liveId },
        data: { totalViewers: { increment: 1 } },
      });
    }
    const updated = await this.refreshViewersCount(liveId);
    this.rt.emitToLive(liveId, 'live:viewers', { liveId, viewersCount: updated.viewersCount });

    const brief = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { userName: true },
    });
    const token = await this.livekit.createSubscriberToken(live.roomName, userId, brief.userName);
    return { live: this.toDto(updated), token, wsUrl: this.livekit.url };
  }

  async leave(userId: string, liveId: string): Promise<LiveOkDto> {
    await this.prisma.liveViewer.updateMany({
      where: { liveId, userId, leftAt: null },
      data: { leftAt: new Date() },
    });
    const updated = await this.refreshViewersCount(liveId);
    this.rt.emitToLive(liveId, 'live:viewers', { liveId, viewersCount: updated.viewersCount });
    return { ok: true };
  }

  // ─────────────── интеракции ───────────────

  async comment(userId: string, liveId: string, dto: LiveCommentInputDto): Promise<LiveCommentDto> {
    const live = await this.getRaw(liveId);
    await this.assertCanView(userId, live);
    const row = await this.prisma.liveComment.create({
      data: { liveId, userId, text: dto.text },
      select: { id: true, text: true, createdAt: true, user: { select: USER_BRIEF } },
    });
    const out: LiveCommentDto = {
      id: row.id,
      user: this.toBrief(row.user),
      text: row.text,
      createdAt: row.createdAt,
    };
    this.rt.emitToLive(liveId, 'live:comment', out);
    return out;
  }

  /**
   * Лента комментариев эфира: новые → старые, курсор = id последнего элемента.
   *
   * До этого API умел только писать (POST /live/{id}/comment): зритель видел
   * лишь свои комментарии и те, что пришли в сокет ПОСЛЕ подключения. Зайти в
   * идущий эфир и увидеть, о чём говорят, было нельзя.
   *
   * Доступ — тот же assertCanView, что у join(): приватность и блок работают
   * одинаково, иначе лента комментариев стала бы обходом закрытого эфира.
   */
  async comments(userId: string, liveId: string, dto: CursorDto): Promise<CursorPage<LiveCommentDto>> {
    const live = await this.getRaw(liveId);
    await this.assertCanView(userId, live);

    const rows = await this.prisma.liveComment.findMany({
      where: { liveId },
      select: { id: true, text: true, createdAt: true, user: { select: USER_BRIEF } },
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });

    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return {
      ...page,
      items: page.items.map((r) => ({
        id: r.id,
        user: this.toBrief(r.user),
        text: r.text,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Заявки в эфир — только хосту.
   *
   * Без этого списка 2 из 18 live-endpoint'ов были недостижимы: id заявки
   * возвращался тому, КТО попросился, а хосту (кто принимает) — никуда.
   */
  async requests(hostId: string, liveId: string, status?: JoinStatus): Promise<JoinRequestDto[]> {
    const live = await this.getRaw(liveId);
    this.assertHost(live, hostId); // не хост → 403

    const rows = await this.prisma.liveJoinRequest.findMany({
      where: { liveId, ...(status ? { status } : {}) },
      select: { id: true, status: true, createdAt: true, user: { select: USER_BRIEF } },
      orderBy: { id: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      user: this.toBrief(r.user),
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /** Лайк можно слать МНОГО РАЗ — каждый идёт как всплывающее сердечко. */
  async like(userId: string, liveId: string): Promise<LiveLikeResultDto> {
    const live = await this.getRaw(liveId);
    await this.assertCanView(userId, live);
    await this.prisma.liveLike.create({ data: { liveId, userId } });
    const updated = await this.prisma.live.update({
      where: { id: liveId },
      data: { likesCount: { increment: 1 } },
      select: { likesCount: true },
    });
    this.rt.emitToLive(liveId, 'live:like', { liveId, userId, likesCount: updated.likesCount });
    return { likesCount: updated.likesCount };
  }

  async reaction(userId: string, liveId: string, dto: LiveReactionInputDto): Promise<LiveOkDto> {
    const live = await this.getRaw(liveId);
    await this.assertCanView(userId, live);
    await this.prisma.liveReaction.create({ data: { liveId, userId, emoji: dto.emoji } });
    this.rt.emitToLive(liveId, 'live:reaction', { liveId, userId, emoji: dto.emoji });
    return { ok: true };
  }

  // ─────────────── гости (заявки на участие) ───────────────

  async requestJoin(userId: string, liveId: string): Promise<JoinRequestDto> {
    const live = await this.getRaw(liveId);
    if (live.status === LiveStatus.ENDED) throw new BadRequestException('Эфир завершён');
    await this.assertCanView(userId, live);
    if (userId === live.hostId) throw new BadRequestException('Вы хост этого эфира');

    const row = await this.prisma.liveJoinRequest.upsert({
      where: { liveId_userId: { liveId, userId } },
      create: { liveId, userId, status: JoinStatus.PENDING },
      update: { status: JoinStatus.PENDING, decidedAt: null },
      select: { id: true, status: true, createdAt: true, user: { select: USER_BRIEF } },
    });
    const out: JoinRequestDto = {
      id: row.id,
      user: this.toBrief(row.user),
      status: row.status,
      createdAt: row.createdAt,
    };
    // Хосту — и в сокет (кнопка «принять/отклонить»), и в уведомления.
    this.rt.emitToUser(live.hostId, 'live:join-request', { liveId, request: out });
    this.notify(live.hostId, userId, NotifType.LIVE_JOIN_REQUEST, liveId, row.id);
    return out;
  }

  /** Хост принял заявку → гость становится вторым publisher (split-экран). */
  async acceptRequest(hostId: string, requestId: number): Promise<LiveOkDto> {
    const req = await this.prisma.liveJoinRequest.findUnique({
      where: { id: requestId },
      select: { id: true, userId: true, status: true, live: { select: LIVE_SELECT } },
    });
    if (!req) throw new NotFoundException('Заявка не найдена');
    this.assertHost(req.live, hostId);
    if (req.live.status === LiveStatus.ENDED) throw new BadRequestException('Эфир завершён');

    await this.prisma.$transaction([
      this.prisma.liveJoinRequest.update({
        where: { id: requestId },
        data: { status: JoinStatus.ACCEPTED, decidedAt: new Date() },
      }),
      this.prisma.liveGuest.upsert({
        where: { liveId_userId: { liveId: req.live.id, userId: req.userId } },
        create: { liveId: req.live.id, userId: req.userId },
        update: { leftAt: null },
      }),
    ]);

    const guest = await this.prisma.user.findUniqueOrThrow({
      where: { id: req.userId },
      select: { userName: true },
    });
    // Гостю — publisher-токен приватно, чтобы начать вещать.
    const token = await this.livekit.createPublisherToken(
      req.live.roomName,
      req.userId,
      guest.userName,
    );
    this.rt.emitToUser(req.userId, 'live:join-accepted', {
      liveId: req.live.id,
      token,
      wsUrl: this.livekit.url,
    });
    this.rt.emitToLive(req.live.id, 'live:guest-joined', {
      liveId: req.live.id,
      userId: req.userId,
    });
    this.notify(req.userId, hostId, NotifType.LIVE_JOIN_ACCEPTED, req.live.id, req.id);
    return { ok: true };
  }

  async declineRequest(hostId: string, requestId: number): Promise<LiveOkDto> {
    const req = await this.prisma.liveJoinRequest.findUnique({
      where: { id: requestId },
      select: { id: true, userId: true, live: { select: LIVE_SELECT } },
    });
    if (!req) throw new NotFoundException('Заявка не найдена');
    this.assertHost(req.live, hostId);

    await this.prisma.liveJoinRequest.update({
      where: { id: requestId },
      data: { status: JoinStatus.DECLINED, decidedAt: new Date() },
    });
    this.rt.emitToUser(req.userId, 'live:join-declined', { liveId: req.live.id });
    this.notify(req.userId, hostId, NotifType.LIVE_JOIN_DECLINED, req.live.id, req.id);
    return { ok: true };
  }

  // ─────────────── управление эфиром (только хост) ───────────────

  async setCamera(hostId: string, liveId: string, dto: CameraDto): Promise<LiveDto> {
    const live = await this.getRaw(liveId);
    this.assertHost(live, hostId);
    const updated = await this.prisma.live.update({
      where: { id: liveId },
      data: {
        isCameraOn: dto.on,
        ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl } : {}),
      },
      select: LIVE_SELECT,
    });
    // Видео выкл → зрители показывают аватар/обложку; ЗВУК не трогаем.
    this.rt.emitToLive(liveId, 'live:camera', {
      liveId,
      isCameraOn: updated.isCameraOn,
      coverUrl: updated.coverUrl,
    });
    return this.toDto(updated);
  }

  async setAudio(hostId: string, liveId: string, dto: AudioDto): Promise<LiveDto> {
    const live = await this.getRaw(liveId);
    this.assertHost(live, hostId);
    const updated = await this.prisma.live.update({
      where: { id: liveId },
      data: { isAudioOn: dto.on },
      select: LIVE_SELECT,
    });
    this.rt.emitToLive(liveId, 'live:audio', { liveId, isAudioOn: updated.isAudioOn });
    return this.toDto(updated);
  }

  async kick(hostId: string, liveId: string, targetUserId: string): Promise<LiveOkDto> {
    const live = await this.getRaw(liveId);
    this.assertHost(live, hostId);
    if (targetUserId === hostId) throw new BadRequestException('Нельзя выгнать себя');

    await this.prisma.liveViewer.updateMany({
      where: { liveId, userId: targetUserId, leftAt: null },
      data: { leftAt: new Date() },
    });
    await this.prisma.liveGuest.updateMany({
      where: { liveId, userId: targetUserId, leftAt: null },
      data: { leftAt: new Date() },
    });
    await this.livekit.removeParticipant(live.roomName, targetUserId);
    const updated = await this.refreshViewersCount(liveId);

    this.rt.emitToUser(targetUserId, 'live:kicked', { liveId });
    this.rt.emitToLive(liveId, 'live:guest-left', { liveId, userId: targetUserId });
    this.rt.emitToLive(liveId, 'live:viewers', { liveId, viewersCount: updated.viewersCount });
    return { ok: true };
  }

  async stats(liveId: string): Promise<LiveStatsDto> {
    const live = await this.getRaw(liveId);
    const [commentsCount, reactionsCount] = await Promise.all([
      this.prisma.liveComment.count({ where: { liveId } }),
      this.prisma.liveReaction.count({ where: { liveId } }),
    ]);
    const end = live.endedAt ?? new Date();
    return {
      viewersCount: live.viewersCount,
      peakViewers: live.peakViewers,
      totalViewers: live.totalViewers,
      likesCount: live.likesCount,
      commentsCount,
      reactionsCount,
      durationSec: Math.max(0, Math.round((end.getTime() - live.startedAt.getTime()) / 1000)),
    };
  }

  // ─────────────── helpers ───────────────

  private async getRaw(liveId: string): Promise<LiveRow> {
    const live = await this.prisma.live.findUnique({ where: { id: liveId }, select: LIVE_SELECT });
    if (!live) throw new NotFoundException('Эфир не найден');
    return live;
  }

  private assertHost(live: LiveRow, userId: string): void {
    if (live.hostId !== userId) throw new ForbiddenException('Только хост эфира может это делать');
  }

  /**
   * Доступ к эфиру: блок в любую сторону — 403. Приватный хост — только принятые подписчики
   * (или сам хост). Публичный хост виден всем (в т.ч. не подписчикам — через поиск).
   */
  private async assertCanView(userId: string, live: LiveRow): Promise<void> {
    if (userId === live.hostId) return;
    if (await this.access.isBlockedBetween(userId, live.hostId)) {
      throw new ForbiddenException('Доступ к эфиру закрыт');
    }
    if (live.host.isPrivate) {
      const follows = await this.access.isFollowing(userId, live.hostId);
      if (!follows)
        throw new ForbiddenException('Аккаунт закрыт — подпишитесь, чтобы смотреть эфир');
    }
  }

  private async refreshViewersCount(liveId: string): Promise<LiveRow> {
    const count = await this.prisma.liveViewer.count({ where: { liveId, leftAt: null } });
    const current = await this.prisma.live.findUniqueOrThrow({
      where: { id: liveId },
      select: { peakViewers: true },
    });
    return this.prisma.live.update({
      where: { id: liveId },
      data: { viewersCount: count, peakViewers: Math.max(current.peakViewers, count) },
      select: LIVE_SELECT,
    });
  }

  private notify(
    userId: string,
    actorId: string,
    type: NotifType,
    liveId: string,
    requestId?: number,
  ): void {
    this.events.emit(NOTIFY_EVENT, {
      userId,
      actorId,
      type,
      liveId,
      requestId,
    } satisfies NotifyPayload);
  }

  private toDto(r: LiveRow): LiveDto {
    return {
      id: r.id,
      host: this.toBrief(r.host),
      title: r.title,
      status: r.status,
      isCameraOn: r.isCameraOn,
      isAudioOn: r.isAudioOn,
      coverUrl: r.coverUrl,
      viewersCount: r.viewersCount,
      likesCount: r.likesCount,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
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
