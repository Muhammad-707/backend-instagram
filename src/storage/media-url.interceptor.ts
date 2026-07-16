import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { StorageService } from './storage.service';

/**
 * Собирает публичные ссылки на медиа В МОМЕНТ ОТДАЧИ.
 *
 * В БД лежит ключ (`images/2026/07/a.webp`), а не абсолютный URL — иначе смена
 * домена ломает все старые записи (см. StorageService.put). Значит, кто-то
 * должен превратить ключ в ссылку. Делать это в каждом маппере — верный способ
 * забыть один из них: URL-поля раскиданы по постам, историям, чатам, музыке,
 * эфирам, актуальным и профилю. Поэтому — одно место на весь ответ.
 *
 * Обрабатываются только поля из MEDIA_FIELDS: гулять по всем строкам подряд
 * нельзя, иначе ссылку внутри текста комментария тоже бы «починили».
 *
 * Идемпотентно: publicUrlFor() принимает и ключ, и уже готовый (старый) URL,
 * поэтому повторный проход или запись из старой базы ничего не портят.
 */
const MEDIA_FIELDS: ReadonlySet<string> = new Set([
  'avatarUrl',
  'url',
  'thumbUrl',
  'coverUrl',
  'mediaUrl',
  'fileUrl',
  'stickerUrl',
  'postThumbUrl',
]);

/** Глубина рекурсии: ответы плоские (item → user → avatarUrl), 8 с запасом. */
const MAX_DEPTH = 8;

@Injectable()
export class MediaUrlInterceptor implements NestInterceptor {
  constructor(private readonly storage: StorageService) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => this.walk(data, 0)));
  }

  private walk(node: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return node;

    // Date/Buffer и прочие не-plain объекты не трогаем: обходить их незачем,
    // а Object.entries на Date вернул бы пустоту и стёр значение.
    if (node instanceof Date || Buffer.isBuffer(node)) return node;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = this.walk(node[i], depth + 1);
      return node;
    }

    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && MEDIA_FIELDS.has(key)) {
        obj[key] = this.storage.publicUrlFor(value);
      } else if (value !== null && typeof value === 'object') {
        obj[key] = this.walk(value, depth + 1);
      }
    }
    return obj;
  }
}
