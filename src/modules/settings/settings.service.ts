import { ForbiddenException, Injectable } from '@nestjs/common';
import { CommentPolicy, InteractionPolicy, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserBriefDto } from '../users/dto/users.dto';
import { RestrictActionDto, SettingsDto, UpdateSettingsDto } from './dto/settings.dto';

/**
 * Настройки аккаунта + приватность взаимодействий.
 *
 * Кроме CRUD настроек здесь живут проверки политик (canTag/canMention/
 * canComment/canMessage) — их дёргают модули posts/chat/stories, поэтому сервис
 * экспортируется. Одна дверь = одна логика: политику нельзя нечаянно обойти в
 * одном месте и забыть в другом.
 */
const DEFAULTS: SettingsDto = {
  pushEnabled: true,
  emailEnabled: true,
  whoCanTag: InteractionPolicy.EVERYONE,
  whoCanMention: InteractionPolicy.EVERYONE,
  whoCanMessage: InteractionPolicy.EVERYONE,
  whoCanComment: CommentPolicy.EVERYONE,
  allowGifComments: true,
  allowStoryReshare: true,
  hiddenWords: [],
  language: 'ru',
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async get(userId: string): Promise<SettingsDto> {
    const row = await this.prisma.userSettings.findUnique({ where: { userId } });
    return row ? this.toDto(row) : { ...DEFAULTS };
  }

  async update(userId: string, dto: UpdateSettingsDto): Promise<SettingsDto> {
    const data: Prisma.UserSettingsUncheckedCreateInput = { userId, ...dto };
    const row = await this.prisma.userSettings.upsert({
      where: { userId },
      create: data,
      update: dto,
    });
    return this.toDto(row);
  }

  // ─────────────── ограниченные аккаунты ───────────────

  async restrict(userId: string, targetId: string): Promise<RestrictActionDto> {
    if (userId === targetId) throw new ForbiddenException('Нельзя ограничить себя');
    await this.prisma.restrictedAccount.upsert({
      where: { userId_restrictedId: { userId, restrictedId: targetId } },
      create: { userId, restrictedId: targetId },
      update: {},
    });
    return { restricted: true };
  }

  async unrestrict(userId: string, targetId: string): Promise<RestrictActionDto> {
    await this.prisma.restrictedAccount
      .delete({ where: { userId_restrictedId: { userId, restrictedId: targetId } } })
      .catch(() => undefined);
    return { restricted: false };
  }

  async restrictedIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.restrictedAccount.findMany({
      where: { userId },
      select: { restrictedId: true },
    });
    return rows.map((r) => r.restrictedId);
  }

  async restrictedList(userId: string): Promise<UserBriefDto[]> {
    const rows = await this.prisma.restrictedAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        restricted: {
          select: {
            id: true,
            userName: true,
            fullName: true,
            isVerified: true,
            isPrivate: true,
            profile: { select: { avatarUrl: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.restricted.id,
      userName: r.restricted.userName,
      fullName: r.restricted.fullName,
      avatarUrl: r.restricted.profile?.avatarUrl ?? null,
      isVerified: r.restricted.isVerified,
      isPrivate: r.restricted.isPrivate,
    }));
  }

  async isRestricted(ownerId: string, actorId: string): Promise<boolean> {
    const row = await this.prisma.restrictedAccount.findUnique({
      where: { userId_restrictedId: { userId: ownerId, restrictedId: actorId } },
      select: { id: true },
    });
    return Boolean(row);
  }

  // ─────────────── проверки политик ───────────────

  private async raw(userId: string): Promise<SettingsDto> {
    return this.get(userId);
  }

  /** Политика EVERYONE/FOLLOWING/NOBODY: может ли actor взаимодействовать с owner. */
  private async passesInteraction(
    policy: InteractionPolicy,
    ownerId: string,
    actorId: string,
  ): Promise<boolean> {
    if (ownerId === actorId) return true;
    if (policy === InteractionPolicy.NOBODY) return false;
    if (policy === InteractionPolicy.EVERYONE) return true;
    // FOLLOWING — только те, на кого подписан сам owner.
    return this.access.isFollowing(ownerId, actorId);
  }

  /** Может ли actor отметить owner на публикации. */
  async canTag(ownerId: string, actorId: string): Promise<boolean> {
    const s = await this.raw(ownerId);
    return this.passesInteraction(s.whoCanTag, ownerId, actorId);
  }

  /** Может ли actor @упомянуть owner. */
  async canMention(ownerId: string, actorId: string): Promise<boolean> {
    const s = await this.raw(ownerId);
    return this.passesInteraction(s.whoCanMention, ownerId, actorId);
  }

  /** Может ли sender писать owner напрямую (иначе сообщение уходит в запросы). */
  async canMessage(ownerId: string, senderId: string): Promise<boolean> {
    const s = await this.raw(ownerId);
    return this.passesInteraction(s.whoCanMessage, ownerId, senderId);
  }

  /**
   * Может ли commenter комментировать пост автора. Бросает 403, если политика
   * запрещает, аккаунт ограничен, или текст содержит скрытое слово.
   */
  async assertCanComment(authorId: string, commenterId: string, text: string): Promise<void> {
    if (authorId === commenterId) return; // свой пост комментируем всегда
    const s = await this.raw(authorId);

    if (s.whoCanComment === CommentPolicy.OFF) {
      throw new ForbiddenException('Автор отключил комментарии');
    }
    if (s.whoCanComment === CommentPolicy.FOLLOWERS) {
      if (!(await this.access.isFollowing(commenterId, authorId))) {
        throw new ForbiddenException('Комментировать могут только подписчики автора');
      }
    }
    if (s.whoCanComment === CommentPolicy.MUTUAL) {
      const [aFollowsB, bFollowsA] = await Promise.all([
        this.access.isFollowing(commenterId, authorId),
        this.access.isFollowing(authorId, commenterId),
      ]);
      if (!aFollowsB || !bFollowsA) {
        throw new ForbiddenException('Комментировать могут только взаимные подписчики');
      }
    }
    if (await this.isRestricted(authorId, commenterId)) {
      throw new ForbiddenException('Вы ограничены автором — комментарий недоступен');
    }
    if (this.containsHiddenWord(s.hiddenWords, text)) {
      throw new ForbiddenException('Комментарий содержит скрытое слово');
    }
  }

  private containsHiddenWord(words: string[], text: string): boolean {
    if (words.length === 0) return false;
    const lower = text.toLowerCase();
    return words.some((w) => w && lower.includes(w.toLowerCase()));
  }

  private toDto(row: {
    pushEnabled: boolean;
    emailEnabled: boolean;
    whoCanTag: InteractionPolicy;
    whoCanMention: InteractionPolicy;
    whoCanMessage: InteractionPolicy;
    whoCanComment: CommentPolicy;
    allowGifComments: boolean;
    allowStoryReshare: boolean;
    hiddenWords: string[];
    language: string;
  }): SettingsDto {
    return {
      pushEnabled: row.pushEnabled,
      emailEnabled: row.emailEnabled,
      whoCanTag: row.whoCanTag,
      whoCanMention: row.whoCanMention,
      whoCanMessage: row.whoCanMessage,
      whoCanComment: row.whoCanComment,
      allowGifComments: row.allowGifComments,
      allowStoryReshare: row.allowStoryReshare,
      hiddenWords: row.hiddenWords,
      language: row.language,
    };
  }
}
