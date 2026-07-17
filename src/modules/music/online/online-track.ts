import { MusicProvider } from '@prisma/client';

/**
 * Трек во внешнем каталоге, приведённый к одной форме.
 *
 * Ровно то, что нужно, чтобы показать строку в поиске и прикрепить трек к
 * посту/заметке/истории/сообщению: название, исполнитель, обложка, длительность
 * и 30-сек превью. Дальше провайдер значения не имеет — ни чат, ни заметки о нём
 * не знают, они работают с нашим `Music.id`.
 */
export interface OnlineTrack {
  provider: MusicProvider;
  /** id трека в каталоге провайдера. Уникален только внутри провайдера. */
  externalId: string;
  title: string;
  artist: string;
  coverUrl: string;
  /** Секунды. */
  duration: number;
  /**
   * 30-сек превью (mp3/m4a) либо null, если каталог его не дал.
   * Полного трека внешние каталоги не отдают — ни один.
   */
  previewUrl: string | null;
  /** Страница трека у провайдера — фолбэк, если превью нет. */
  pageUrl: string;
}

/** Провайдер внешнего каталога музыки. */
export interface OnlineMusicProvider {
  readonly provider: MusicProvider;
  /** Готов ли провайдер работать (ключи на месте и т.п.). */
  isConfigured(): boolean;
  search(query: string, limit: number): Promise<OnlineTrack[]>;
  getTrack(externalId: string): Promise<OnlineTrack>;
}
