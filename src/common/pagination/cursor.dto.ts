import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Курсорная пагинация — на всех лентах (баг softclub #4, #21). */
export class CursorDto {
  @ApiPropertyOptional({ description: 'Курсор последнего элемента предыдущей страницы' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Берём limit+1 записей, лишняя говорит, что есть следующая страница.
 */
export function buildCursorPage<T>(
  rows: T[],
  limit: number,
  getCursor: (row: T) => string | number,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last !== undefined ? String(getCursor(last)) : null,
    hasMore,
  };
}
