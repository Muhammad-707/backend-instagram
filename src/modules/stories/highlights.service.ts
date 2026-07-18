import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StoriesService } from './stories.service';
import {
  CreateHighlightDto,
  HighlightDto,
  HighlightWithStoriesDto,
  UpdateHighlightDto,
} from './dto/highlight.dto';
import { StoryDto } from './dto/story.dto';

@Injectable()
export class HighlightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly stories: StoriesService,
  ) {}

  /**
   * Создать «Актуальное». Истории должны принадлежать мне.
   * Ключевое: попав в highlight, история переживает 24ч — BullMQ-процессор перед удалением
   * проверяет связь HighlightStory и оставляет такие истории в живых.
   */
  async create(userId: string, dto: CreateHighlightDto): Promise<HighlightDto> {
    const stories = await this.assertOwnStories(userId, dto.storyIds);

    const cover = dto.coverUrl ?? stories[0]?.thumbUrl ?? stories[0]?.mediaUrl ?? null;

    const highlight = await this.prisma.highlight.create({
      data: {
        userId,
        title: dto.title,
        coverUrl: cover,
        stories: {
          create: dto.storyIds.map((storyId, order) => ({ storyId, order })),
        },
      },
      select: { id: true, title: true, coverUrl: true, createdAt: true },
    });

    return { ...highlight, count: dto.storyIds.length };
  }

  async list(viewerId: string, targetId: string): Promise<HighlightDto[]> {
    // Актуальное — публичная витрина профиля; закрыто блокировкой/приватностью.
    await this.access.assertCanViewContent(viewerId, targetId);

    const rows = await this.prisma.highlight.findMany({
      where: { userId: targetId },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        createdAt: true,
        _count: { select: { stories: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((h) => ({
      id: h.id,
      title: h.title,
      coverUrl: h.coverUrl,
      count: h._count.stories,
      createdAt: h.createdAt,
    }));
  }

  async byId(viewerId: string, id: string): Promise<HighlightWithStoriesDto> {
    const highlight = await this.prisma.highlight.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        title: true,
        coverUrl: true,
        createdAt: true,
        stories: { select: { storyId: true }, orderBy: { order: 'asc' } },
      },
    });
    if (!highlight) throw new NotFoundException('Актуальное не найдено');
    await this.access.assertCanViewContent(viewerId, highlight.userId);

    // Истории в highlight не истекают, поэтому берём их без фильтра по expiresAt.
    const storyIds = highlight.stories.map((s) => s.storyId);
    const stories = await this.loadStories(viewerId, storyIds);

    return {
      id: highlight.id,
      title: highlight.title,
      coverUrl: highlight.coverUrl,
      count: storyIds.length,
      createdAt: highlight.createdAt,
      stories,
    };
  }

  async update(userId: string, id: string, dto: UpdateHighlightDto): Promise<HighlightDto> {
    const highlight = await this.prisma.highlight.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!highlight) throw new NotFoundException('Актуальное не найдено');
    if (highlight.userId !== userId) throw new ForbiddenException('Это не ваше актуальное');

    if (dto.storyIds) {
      await this.assertOwnStories(userId, dto.storyIds);
      // Заменяем состав целиком — проще и предсказуемее, чем diff.
      await this.prisma.highlightStory.deleteMany({ where: { highlightId: id } });
      await this.prisma.highlightStory.createMany({
        data: dto.storyIds.map((storyId, order) => ({ highlightId: id, storyId, order })),
      });
    }

    const updated = await this.prisma.highlight.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl } : {}),
      },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        createdAt: true,
        _count: { select: { stories: true } },
      },
    });

    return {
      id: updated.id,
      title: updated.title,
      coverUrl: updated.coverUrl,
      count: updated._count.stories,
      createdAt: updated.createdAt,
    };
  }

  async remove(userId: string, id: string): Promise<{ deleted: boolean }> {
    const highlight = await this.prisma.highlight.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!highlight) throw new NotFoundException('Актуальное не найдено');
    if (highlight.userId !== userId) throw new ForbiddenException('Это не ваше актуальное');

    // Удаляем только highlight; сами истории остаются (могут быть в других актуальных).
    await this.prisma.highlight.delete({ where: { id } });
    return { deleted: true };
  }

  private async assertOwnStories(
    userId: string,
    storyIds: number[],
  ): Promise<{ thumbUrl: string | null; mediaUrl: string }[]> {
    const stories = await this.prisma.story.findMany({
      where: { id: { in: storyIds } },
      select: { id: true, userId: true, thumbUrl: true, mediaUrl: true },
    });

    if (stories.length !== storyIds.length) {
      throw new NotFoundException('Некоторые истории не найдены');
    }
    if (stories.some((s) => s.userId !== userId)) {
      throw new ForbiddenException('В актуальное можно добавить только свои истории');
    }
    // Сохраняем порядок storyIds, чтобы обложка бралась из первой указанной истории.
    const byId = new Map(stories.map((s) => [s.id, s]));
    return storyIds.map((id) => {
      const s = byId.get(id);
      if (!s) throw new NotFoundException('История не найдена');
      return { thumbUrl: s.thumbUrl, mediaUrl: s.mediaUrl };
    });
  }

  /** Загружаем истории highlight напрямую (в обход 24ч-фильтра), с isViewed/isLiked зрителя. */
  private async loadStories(viewerId: string, storyIds: number[]): Promise<StoryDto[]> {
    if (storyIds.length === 0) return [];

    const [views, likes] = await Promise.all([
      this.prisma.storyView.findMany({
        where: { userId: viewerId, storyId: { in: storyIds } },
        select: { storyId: true },
      }),
      this.prisma.storyLike.findMany({
        where: { userId: viewerId, storyId: { in: storyIds } },
        select: { storyId: true },
      }),
    ]);
    const viewed = new Set(views.map((v) => v.storyId));
    const liked = new Set(likes.map((l) => l.storyId));

    const rows = await this.prisma.story.findMany({
      where: { id: { in: storyIds } },
      select: {
        id: true,
        userId: true,
        mediaUrl: true,
        mediaType: true,
        thumbUrl: true,
        duration: true,
        musicStartSec: true,
        overlays: true,
        filter: true,
        closeFriendsOnly: true,
        saveToArchive: true,
        fromPostId: true,
        addYoursPromptId: true,
        createdAt: true,
        expiresAt: true,
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
      },
    });
    const order = new Map(storyIds.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    return rows.map((r) => this.stories.buildDto(r, viewed.has(r.id), liked.has(r.id)));
  }
}

// Тип строки для buildDto — совпадает с select выше.
export type HighlightStoryRow = Prisma.StoryGetPayload<{
  select: {
    id: true;
    userId: true;
    mediaUrl: true;
    mediaType: true;
    thumbUrl: true;
    duration: true;
    musicStartSec: true;
    overlays: true;
    filter: true;
    closeFriendsOnly: true;
    saveToArchive: true;
    fromPostId: true;
    addYoursPromptId: true;
    createdAt: true;
    expiresAt: true;
    music: {
      select: {
        id: true;
        title: true;
        artist: true;
        coverUrl: true;
        url: true;
        provider: true;
        externalId: true;
      };
    };
    _count: { select: { likes: true } };
  };
}>;
