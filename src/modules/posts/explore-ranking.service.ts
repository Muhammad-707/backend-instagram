import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

/**
 * Персонализация Explore и Reels (Фаза 2). В IG сетка Explore и лента Reels — не хронология,
 * а подбор по интересам: хэштеги/темы, с которыми ты взаимодействовал, + вирусный свежий контент,
 * с дедупликацией авторов (один автор не занимает весь экран).
 *
 *   score = w_interest·interestMatch + w_engagement·engagementRate + w_recency·recency
 *
 * interestMatch — совпадение хэштегов поста с профилем интересов зрителя (его лайки/просмотры/
 * сохранения за 30 дней). Профиль кэшируется в Redis (TTL 1ч). После скоринга — дедуп авторов
 * (не два поста одного автора подряд).
 */

const W_INTEREST = 1.0;
const W_ENGAGEMENT = 0.5;
const W_RECENCY = 0.4;

const INTEREST_WINDOW_DAYS = 30;
const RECENCY_HALF_LIFE_HOURS = 72; // Explore живёт дольше ленты — свежесть затухает медленнее
const INTEREST_TTL_SEC = 3600;

/** Взвешивание сигналов интереса: сохранение важнее просмотра. */
const INTEREST_WEIGHTS = { favorite: 4, like: 3, view: 1 };

/** Минимальная форма кандидата для скоринга (без завязки на PostRow из posts.service). */
export interface ExploreCandidate {
  id: number;
  userId: string;
  createdAt: Date;
  hashtags: string[];
  likes: number;
  comments: number;
  views: number;
  favorites: number;
}

@Injectable()
export class ExploreRankingService {
  private readonly logger = new Logger(ExploreRankingService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('EXPLORE_RANKED', true);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Ранжирует кандидатов по интересам зрителя и возвращает id в порядке показа
   * с дедупликацией авторов (не два поста одного автора подряд).
   */
  async rank(viewerId: string, candidates: ExploreCandidate[]): Promise<number[]> {
    if (candidates.length === 0) return [];
    const interest = await this.interestProfile(viewerId);
    const now = Date.now();

    const scored = candidates.map((c) => {
      const ageHours = (now - c.createdAt.getTime()) / 3_600_000;
      const recency = Math.exp((-Math.LN2 * ageHours) / RECENCY_HALF_LIFE_HOURS);
      const engagement = engagementRate(c);
      const match = interestMatch(c.hashtags, interest);
      const score = W_INTEREST * match + W_ENGAGEMENT * engagement + W_RECENCY * recency;
      return { id: c.id, userId: c.userId, score };
    });

    scored.sort((a, b) => b.score - a.score || b.id - a.id);
    return dedupeAuthors(scored);
  }

  /**
   * Профиль интересов: хэштег→вес, из лайков/просмотров/сохранений зрителя за 30 дней.
   * Кэш в Redis на 1ч (интересы меняются медленно). Деградирует без Redis.
   */
  private async interestProfile(viewerId: string): Promise<Map<string, number>> {
    const key = `explore:interest:${viewerId}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        return new Map(Object.entries(JSON.parse(cached) as Record<string, number>));
      } catch {
        // повреждённый кэш — пересчитаем
      }
    }

    const map = await this.computeInterest(viewerId);
    await this.redis
      .set(key, JSON.stringify(Object.fromEntries(map)), INTEREST_TTL_SEC)
      .catch((e) => this.logger.warn(`interest cache set failed: ${(e as Error).message}`));
    return map;
  }

  private async computeInterest(viewerId: string): Promise<Map<string, number>> {
    const since = new Date(Date.now() - INTEREST_WINDOW_DAYS * 86_400_000);
    const tags = { select: { hashtags: { select: { hashtag: { select: { name: true } } } } } };

    const [likes, views, favorites] = await Promise.all([
      this.prisma.postLike.findMany({
        where: { userId: viewerId, createdAt: { gte: since } },
        select: { post: tags },
      }),
      this.prisma.postView.findMany({
        where: { userId: viewerId, viewedAt: { gte: since } },
        select: { post: tags },
      }),
      this.prisma.favorite.findMany({
        where: { userId: viewerId, createdAt: { gte: since } },
        select: { post: tags },
      }),
    ]);

    const raw = new Map<string, number>();
    const add = (
      rows: { post: { hashtags: { hashtag: { name: string } }[] } }[],
      weight: number,
    ): void => {
      for (const r of rows) {
        for (const h of r.post.hashtags) {
          raw.set(h.hashtag.name, (raw.get(h.hashtag.name) ?? 0) + weight);
        }
      }
    };
    add(likes, INTEREST_WEIGHTS.like);
    add(views, INTEREST_WEIGHTS.view);
    add(favorites, INTEREST_WEIGHTS.favorite);

    // log-сжатие: первые взаимодействия с темой важны, дальше насыщение (norm ≈ 1 при raw≈30).
    const map = new Map<string, number>();
    for (const [name, value] of raw) {
      map.set(name, Math.min(1, Math.log1p(value) / Math.log1p(30)));
    }
    return map;
  }

  async invalidateInterest(viewerId: string): Promise<void> {
    await this.redis.del(`explore:interest:${viewerId}`).catch(() => undefined);
  }
}

/** Сумма весов интереса по хэштегам поста, сжата в 0..1. Нет совпадений → 0. */
function interestMatch(hashtags: string[], interest: Map<string, number>): number {
  if (hashtags.length === 0 || interest.size === 0) return 0;
  let sum = 0;
  for (const h of hashtags) sum += interest.get(h) ?? 0;
  return Math.min(1, sum / 2); // 2 сильных совпадения (по ~1.0) → максимум
}

function engagementRate(c: {
  likes: number;
  comments: number;
  views: number;
  favorites: number;
}): number {
  const weighted = c.likes + c.comments * 2 + c.favorites * 3;
  const rate = weighted / Math.max(c.views, 1);
  return Math.min(1, Math.log1p(rate) / Math.log1p(10));
}

/**
 * Переставляет ранжированный список так, чтобы один автор не шёл двумя постами подряд
 * (если возможно): каждый раз берём самый высокий по score пост с автором ≠ предыдущего.
 */
function dedupeAuthors(scored: { id: number; userId: string }[]): number[] {
  const remaining = [...scored];
  const out: number[] = [];
  let prev: string | null = null;
  while (remaining.length > 0) {
    let idx = remaining.findIndex((p) => p.userId !== prev);
    if (idx < 0) idx = 0; // остались только посты того же автора — деваться некуда
    const [picked] = remaining.splice(idx, 1);
    out.push(picked.id);
    prev = picked.userId;
  }
  return out;
}
