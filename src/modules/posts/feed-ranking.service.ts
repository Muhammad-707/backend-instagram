import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

/**
 * Ранжирование ленты (Feed Ranking) — как в настоящем Instagram лента НЕ хронологическая.
 * Кандидаты (посты подписок + свои за окно) скорятся по формуле:
 *
 *   score = w_affinity·affinity + w_recency·recency + w_engagement·engagementRate − w_seen·alreadySeen
 *
 * — affinity(viewer→author): как часто я взаимодействую с автором (лайки/комменты/просмотры/сообщения
 *   за 30 дней). Считается один раз на весь запрос и кэшируется в Redis (TTL 1ч).
 * — recency: экспоненциальное затухание по возрасту поста.
 * — engagementRate: (likes + comments·2 + saves·3) / max(views,1) — «качество» поста.
 * — alreadySeen: уже просмотренные (PostView) опускаются вниз, а не исчезают (как «You're all caught up»).
 *
 * Откат на хронологию — флаг FEED_RANKED=false.
 */

/** Веса формулы. Подобраны так, чтобы affinity доминировал (близкие люди важнее вирусности). */
const W_AFFINITY = 1.0;
const W_RECENCY = 0.6;
const W_ENGAGEMENT = 0.4;
const W_SEEN = 1.5; // штраф за «уже видел» — сильный, чтобы просмотренное ушло вниз

/** Окно кандидатов: посты за последние N дней. Старше — в ленте подписок уже неактуальны. */
const CANDIDATE_WINDOW_DAYS = 30;
/** Окно, за которое считаем affinity (взаимодействия viewer→author). */
const AFFINITY_WINDOW_DAYS = 30;
/** Период полураспада свежести: пост суточной давности имеет recency ≈ 0.5. */
const RECENCY_HALF_LIFE_HOURS = 24;
/** «You're all caught up»: непросмотренного нет среди постов подписок за последние N часов. */
const CAUGHT_UP_WINDOW_HOURS = 48;
const AFFINITY_TTL_SEC = 3600;

/** Свой пост получает максимальную близость — сразу после публикации он вверху (как в IG). */
const SELF_AFFINITY = 1.0;

/** Взвешивание типов взаимодействия при расчёте affinity. */
const AFFINITY_WEIGHTS = { message: 5, comment: 4, like: 3, view: 1 };

export interface RankedCandidate {
  postId: number;
  score: number;
  seen: boolean;
}

@Injectable()
export class FeedRankingService {
  private readonly logger = new Logger(FeedRankingService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('FEED_RANKED', true);
  }

  /** Глобальный флаг ранжирования (env FEED_RANKED). Позволяет откатиться на хронологию. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Полный ранжированный список кандидатов (без пагинации) для ленты `viewer`.
   * Отсортирован по убыванию score. Пагинацию делает вызывающий (offset-курсор).
   */
  async rankCandidates(viewerId: string, authorIds: string[]): Promise<RankedCandidate[]> {
    const windowStart = daysAgo(CANDIDATE_WINDOW_DAYS);

    const posts = await this.prisma.post.findMany({
      where: {
        userId: { in: authorIds },
        isArchived: false,
        status: 'PUBLISHED',
        createdAt: { gte: windowStart },
      },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        _count: { select: { likes: true, comments: true, views: true, favorites: true } },
      },
    });
    if (posts.length === 0) return [];

    const [affinity, seenIds] = await Promise.all([
      this.affinityMap(viewerId, authorIds),
      this.seenPostIds(
        viewerId,
        posts.map((p) => p.id),
      ),
    ]);

    const now = Date.now();
    const scored: RankedCandidate[] = posts.map((p) => {
      const seen = seenIds.has(p.id);
      const aff = p.userId === viewerId ? SELF_AFFINITY : (affinity.get(p.userId) ?? 0);
      const ageHours = (now - p.createdAt.getTime()) / 3_600_000;
      const recency = Math.exp((-Math.LN2 * ageHours) / RECENCY_HALF_LIFE_HOURS);
      const engagement = engagementRate(p._count);

      const score =
        W_AFFINITY * aff +
        W_RECENCY * recency +
        W_ENGAGEMENT * engagement -
        W_SEEN * (seen ? 1 : 0);

      return { postId: p.id, score, seen };
    });

    // Стабильная сортировка: по score, при равенстве — свежее вперёд (id desc).
    scored.sort((a, b) => b.score - a.score || b.postId - a.postId);
    return scored;
  }

  /**
   * «You're all caught up» — все посты подписок за последние CAUGHT_UP_WINDOW_HOURS
   * уже во `PostView` (или их вовсе нет). Свои посты не в счёт.
   */
  async isAllCaughtUp(viewerId: string, authorIds: string[]): Promise<boolean> {
    const others = authorIds.filter((id) => id !== viewerId);
    if (others.length === 0) return true;

    const unseen = await this.prisma.post.count({
      where: {
        userId: { in: others },
        isArchived: false,
        status: 'PUBLISHED',
        createdAt: { gte: hoursAgo(CAUGHT_UP_WINDOW_HOURS) },
        views: { none: { userId: viewerId } },
      },
    });
    return unseen === 0;
  }

  // ─────────────────────── affinity ───────────────────────

  /**
   * Карта author→affinity(0..1) для одного зрителя. Кэшируется в Redis на 1ч:
   * взаимодействия за 30 дней меняются медленно, а пересчёт — несколько агрегатов.
   */
  private async affinityMap(viewerId: string, authorIds: string[]): Promise<Map<string, number>> {
    const key = `feed:affinity:${viewerId}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        return new Map(Object.entries(JSON.parse(cached) as Record<string, number>));
      } catch {
        // повреждённый кэш — просто пересчитаем
      }
    }

    const map = await this.computeAffinity(viewerId, authorIds);
    await this.redis
      .set(key, JSON.stringify(Object.fromEntries(map)), AFFINITY_TTL_SEC)
      .catch((e) => this.logger.warn(`affinity cache set failed: ${(e as Error).message}`));
    return map;
  }

  /** Сырые взаимодействия viewer→author за окно → нормированная близость 0..1 (log-сжатие). */
  private async computeAffinity(
    viewerId: string,
    authorIds: string[],
  ): Promise<Map<string, number>> {
    const since = daysAgo(AFFINITY_WINDOW_DAYS);
    const authors = new Set(authorIds);
    const raw = new Map<string, number>();
    const add = (authorId: string | undefined, weight: number): void => {
      if (!authorId || !authors.has(authorId) || authorId === viewerId) return;
      raw.set(authorId, (raw.get(authorId) ?? 0) + weight);
    };

    const [likes, comments, views, messages] = await Promise.all([
      this.prisma.postLike.findMany({
        where: { userId: viewerId, createdAt: { gte: since }, post: { userId: { in: authorIds } } },
        select: { post: { select: { userId: true } } },
      }),
      this.prisma.comment.findMany({
        where: { userId: viewerId, createdAt: { gte: since }, post: { userId: { in: authorIds } } },
        select: { post: { select: { userId: true } } },
      }),
      this.prisma.postView.findMany({
        where: { userId: viewerId, viewedAt: { gte: since }, post: { userId: { in: authorIds } } },
        select: { post: { select: { userId: true } } },
      }),
      // Сообщения viewer в личных (не групповых) чатах с автором.
      this.prisma.message.findMany({
        where: {
          senderId: viewerId,
          sentAt: { gte: since },
          chat: {
            isGroup: false,
            participants: { some: { userId: { in: authorIds } } },
          },
        },
        select: {
          chat: { select: { participants: { select: { userId: true } } } },
        },
      }),
    ]);

    for (const l of likes) add(l.post.userId, AFFINITY_WEIGHTS.like);
    for (const c of comments) add(c.post.userId, AFFINITY_WEIGHTS.comment);
    for (const v of views) add(v.post.userId, AFFINITY_WEIGHTS.view);
    for (const m of messages) {
      // В личном чате участников двое: автор — тот, кто не я.
      for (const p of m.chat.participants) add(p.userId, AFFINITY_WEIGHTS.message);
    }

    // log-сжатие: первые взаимодействия важны, дальше насыщение. norm ≈ 1 при raw≈20.
    const map = new Map<string, number>();
    for (const [authorId, value] of raw) {
      map.set(authorId, Math.min(1, Math.log1p(value) / Math.log1p(20)));
    }
    return map;
  }

  private async seenPostIds(viewerId: string, postIds: number[]): Promise<Set<number>> {
    if (postIds.length === 0) return new Set();
    const rows = await this.prisma.postView.findMany({
      where: { userId: viewerId, postId: { in: postIds } },
      select: { postId: true },
    });
    return new Set(rows.map((r) => r.postId));
  }

  /** Инвалидация кэша affinity зрителя (напр. после массы новых взаимодействий). */
  async invalidateAffinity(viewerId: string): Promise<void> {
    await this.redis.del(`feed:affinity:${viewerId}`).catch(() => undefined);
  }
}

/** (likes + comments·2 + saves·3) / max(views,1), сжато в 0..1 через log. */
function engagementRate(count: {
  likes: number;
  comments: number;
  views: number;
  favorites: number;
}): number {
  const weighted = count.likes + count.comments * 2 + count.favorites * 3;
  const rate = weighted / Math.max(count.views, 1);
  return Math.min(1, Math.log1p(rate) / Math.log1p(10));
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}
