/**
 * Хэштеги и упоминания из текста.
 *
 * Кириллица поддерживается (#закат) — поэтому \p{L} с флагом u, а не [a-z].
 * Границей считаем начало строки или НЕ-словесный символ: «a#b» хэштегом не станет,
 * иначе email вроде user@mail превращался бы в упоминание @mail.
 */
const HASHTAG_RE = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]{1,64})/gu;
const MENTION_RE = /(?<![\p{L}\p{N}_@])@([a-zA-Z0-9._]{3,30})/gu;

export function parseHashtags(text?: string | null): string[] {
  if (!text) return [];
  const found = [...text.matchAll(HASHTAG_RE)].map((m) => m[1].toLowerCase());
  // Один и тот же тег дважды в подписи не должен давать две строки в БД.
  return [...new Set(found)];
}

export function parseMentions(text?: string | null): string[] {
  if (!text) return [];
  const found = [...text.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase());
  return [...new Set(found)];
}
