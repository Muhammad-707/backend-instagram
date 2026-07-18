import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotifType, Prisma, StoryStickerType } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import { UserBriefDto } from '../users/dto/users.dto';
import {
  AnswerResultDto,
  AnswerStickerDto,
  CreateStickerDto,
  StickerDto,
  StickerResultsDto,
} from './dto/sticker.dto';

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

/** Типы, на которые нельзя «ответить» (только показ). */
const NON_ANSWERABLE: StoryStickerType[] = [StoryStickerType.COUNTDOWN, StoryStickerType.LINK];

@Injectable()
export class StoryStickersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly events: EventEmitter2,
  ) {}

  // ─────────────── создание / список ───────────────

  /** Добавить стикер на СВОЮ историю. */
  async create(userId: string, storyId: number, dto: CreateStickerDto): Promise<StickerDto> {
    const story = await this.ownStory(userId, storyId);
    this.validateConfig(dto.type, dto.config);

    // LINK-стикер — только для verified (в IG ссылка была привилегией; у нас — галочка).
    if (dto.type === StoryStickerType.LINK) {
      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isVerified: true },
      });
      if (!me?.isVerified) {
        throw new ForbiddenException(
          'Ссылку в истории можно добавить только с подтверждённым аккаунтом',
        );
      }
    }

    const sticker = await this.prisma.storySticker.create({
      data: {
        storyId: story.id,
        type: dto.type,
        config: dto.config as Prisma.InputJsonValue,
        geometry: (dto.geometry ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return this.toDto(sticker, null, true);
  }

  /** Стикеры истории (для зрителя). Правильный ответ QUIZ скрыт, пока зритель не ответил. */
  async list(viewerId: string, storyId: number): Promise<StickerDto[]> {
    const story = await this.loadVisible(viewerId, storyId);
    const isAuthor = story.userId === viewerId;

    const stickers = await this.prisma.storySticker.findMany({
      where: { storyId },
      orderBy: { createdAt: 'asc' },
      include: {
        responses: {
          where: { userId: viewerId },
          select: { optionIndex: true, text: true, sliderValue: true },
        },
      },
    });

    return stickers.map((s) => {
      const mine = s.responses[0] ?? null;
      const answered = mine !== null || isAuthor;
      return this.toDto(s, mine, answered);
    });
  }

  // ─────────────── ответ ───────────────

  async answer(
    viewerId: string,
    storyId: number,
    stickerId: string,
    dto: AnswerStickerDto,
  ): Promise<AnswerResultDto> {
    const story = await this.loadVisible(viewerId, storyId);
    if (story.userId === viewerId) {
      throw new BadRequestException('Нельзя отвечать на стикер собственной истории');
    }

    const sticker = await this.prisma.storySticker.findFirst({
      where: { id: stickerId, storyId },
    });
    if (!sticker) throw new NotFoundException('Стикер не найден');
    if (NON_ANSWERABLE.includes(sticker.type)) {
      throw new BadRequestException('На этот стикер нельзя ответить');
    }

    const data = this.buildResponse(sticker.type, sticker.config, dto);

    // Одна изменяемая реакция на пару (стикер, юзер) — @@unique → upsert.
    await this.prisma.storyStickerResponse.upsert({
      where: { stickerId_userId: { stickerId, userId: viewerId } },
      create: { stickerId, userId: viewerId, ...data },
      update: data,
    });

    // Уведомляем автора истории о новом ответе (себя не уведомит NotificationsService).
    this.notify(story.userId, viewerId, storyId);

    const result: AnswerResultDto = { ok: true };
    if (sticker.type === StoryStickerType.QUIZ) {
      result.correctIndex = this.quizCorrectIndex(sticker.config);
    }
    return result;
  }

  // ─────────────── итоги (только автору) ───────────────

  async results(userId: string, storyId: number, stickerId: string): Promise<StickerResultsDto> {
    await this.ownStory(userId, storyId);
    const sticker = await this.prisma.storySticker.findFirst({ where: { id: stickerId, storyId } });
    if (!sticker) throw new NotFoundException('Стикер не найден');

    const responses = await this.prisma.storyStickerResponse.findMany({
      where: { stickerId },
      select: { optionIndex: true, text: true, sliderValue: true, user: { select: USER_BRIEF } },
    });
    const total = responses.length;

    switch (sticker.type) {
      case StoryStickerType.POLL:
      case StoryStickerType.QUIZ: {
        const opts = this.configOptions(sticker.config);
        const counts = opts.map((_, index) => ({
          index,
          count: responses.filter((r) => r.optionIndex === index).length,
          percent: 0,
        }));
        for (const c of counts) c.percent = total ? Math.round((c.count / total) * 100) : 0;
        const res: StickerResultsDto = { type: sticker.type, total, options: counts };
        if (sticker.type === StoryStickerType.QUIZ) {
          const correct = this.quizCorrectIndex(sticker.config);
          const right = responses.filter((r) => r.optionIndex === correct).length;
          res.correctPercent = total ? Math.round((right / total) * 100) : 0;
        }
        return res;
      }
      case StoryStickerType.SLIDER: {
        const vals = responses.map((r) => r.sliderValue ?? 0);
        const average = total ? vals.reduce((a, b) => a + b, 0) / total : 0;
        return { type: sticker.type, total, average };
      }
      case StoryStickerType.QUESTION: {
        return {
          type: sticker.type,
          total,
          responses: responses
            .filter((r) => r.text)
            .map((r) => ({ user: this.toBrief(r.user), text: r.text as string })),
        };
      }
      default:
        return { type: sticker.type, total };
    }
  }

  // ─────────────── helpers ───────────────

  private buildResponse(
    type: StoryStickerType,
    config: Prisma.JsonValue,
    dto: AnswerStickerDto,
  ): { optionIndex: number | null; text: string | null; sliderValue: number | null } {
    if (type === StoryStickerType.POLL || type === StoryStickerType.QUIZ) {
      if (dto.optionIndex === undefined) throw new BadRequestException('Нужен optionIndex');
      const opts = this.configOptions(config);
      if (dto.optionIndex < 0 || dto.optionIndex >= opts.length) {
        throw new BadRequestException('optionIndex вне диапазона вариантов');
      }
      return { optionIndex: dto.optionIndex, text: null, sliderValue: null };
    }
    if (type === StoryStickerType.SLIDER) {
      if (dto.sliderValue === undefined) throw new BadRequestException('Нужен sliderValue (0..1)');
      return { optionIndex: null, text: null, sliderValue: dto.sliderValue };
    }
    // QUESTION
    if (!dto.text?.trim()) throw new BadRequestException('Нужен непустой text');
    return { optionIndex: null, text: dto.text.trim(), sliderValue: null };
  }

  private validateConfig(type: StoryStickerType, config: Record<string, unknown>): void {
    const fail = (m: string): never => {
      throw new BadRequestException(m);
    };
    if (type === StoryStickerType.POLL || type === StoryStickerType.QUIZ) {
      const opts = Array.isArray(config.options) ? config.options : null;
      if (!opts || opts.length < 2) fail('POLL/QUIZ: нужен массив options (2+)');
      if (type === StoryStickerType.QUIZ) {
        const ci = config.correctIndex;
        if (typeof ci !== 'number' || ci < 0 || ci >= (opts as unknown[]).length) {
          fail('QUIZ: correctIndex вне диапазона options');
        }
      }
    } else if (type === StoryStickerType.LINK) {
      if (typeof config.url !== 'string' || !/^https?:\/\//.test(config.url)) {
        fail('LINK: нужен корректный url (http/https)');
      }
    } else if (type === StoryStickerType.COUNTDOWN) {
      if (typeof config.endsAt !== 'string' || Number.isNaN(Date.parse(config.endsAt))) {
        fail('COUNTDOWN: нужен endsAt (ISO-дата)');
      }
    }
  }

  private configOptions(config: Prisma.JsonValue): unknown[] {
    const c = config as { options?: unknown };
    return Array.isArray(c.options) ? c.options : [];
  }

  private quizCorrectIndex(config: Prisma.JsonValue): number {
    const c = config as { correctIndex?: number };
    return typeof c.correctIndex === 'number' ? c.correctIndex : -1;
  }

  /** История принадлежит мне (для create/results). */
  private async ownStory(userId: string, storyId: number): Promise<{ id: number; userId: string }> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, userId: true },
    });
    if (!story) throw new NotFoundException('История не найдена');
    if (story.userId !== userId) throw new ForbiddenException('Это не ваша история');
    return story;
  }

  /** Я имею право видеть историю (приватность/блок/близкие друзья). */
  private async loadVisible(
    viewerId: string,
    storyId: number,
  ): Promise<{ id: number; userId: string }> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, userId: true, closeFriendsOnly: true },
    });
    if (!story) throw new NotFoundException('История не найдена');
    await this.access.assertCanViewContent(viewerId, story.userId);
    if (story.closeFriendsOnly && story.userId !== viewerId) {
      const close = await this.prisma.closeFriend.findUnique({
        where: { userId_friendId: { userId: story.userId, friendId: viewerId } },
        select: { userId: true },
      });
      if (!close) throw new ForbiddenException('История доступна только близким друзьям автора');
    }
    return story;
  }

  private notify(userId: string, actorId: string, storyId: number): void {
    this.events.emit(NOTIFY_EVENT, {
      userId,
      actorId,
      type: NotifType.STORY_STICKER_RESPONSE,
      storyId,
    } satisfies NotifyPayload);
  }

  private toDto(
    s: { id: string; type: StoryStickerType; config: Prisma.JsonValue; geometry: Prisma.JsonValue },
    mine: { optionIndex: number | null; text: string | null; sliderValue: number | null } | null,
    answered: boolean,
  ): StickerDto {
    // Скрываем правильный ответ QUIZ, пока зритель не ответил.
    let config = s.config as Record<string, unknown>;
    if (s.type === StoryStickerType.QUIZ && !answered && 'correctIndex' in config) {
      config = { ...config };
      delete config.correctIndex;
    }
    return {
      id: s.id,
      type: s.type,
      config,
      geometry: (s.geometry ?? null) as Record<string, unknown> | null,
      myAnswer: mine,
    };
  }

  private toBrief(u: {
    id: string;
    userName: string;
    fullName: string;
    isVerified: boolean;
    isPrivate: boolean;
    profile: { avatarUrl: string | null } | null;
  }): UserBriefDto {
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
