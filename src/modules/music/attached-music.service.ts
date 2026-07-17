import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MusicProvider } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StorageService } from '../../storage/storage.service';

/**
 * Трек, прикреплённый к посту / истории / заметке / сообщению.
 *
 * Одна форма и один маппер на все четыре места. Раньше каждое строило ответ
 * само и одинаково ошибалось: `streamUrl` собирался безусловно, хотя у трека из
 * внешнего каталога (Deezer/Spotify) нашего mp3 нет — ссылка вела в 404, и
 * пользователь жал play, получая тишину. Правило одно: «играется целиком» — это
 * НЕ происхождение трека, а наличие файла в нашем S3.
 */
export class AttachedMusicDto {
  @ApiProperty({ example: 35 })
  id!: number;

  @ApiProperty({ example: 'Blinding Lights' })
  title!: string;

  @ApiProperty({ example: 'The Weeknd' })
  artist!: string;

  @ApiProperty({ example: 'https://.../cover.jpg' })
  coverUrl!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Наш стриминг с Range (перемотка) — только если mp3 лежит у нас. ' +
      'У трека из внешнего каталога null: полного файла нет.',
  })
  streamUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Что играет у внешнего трека — 30-сек превью каталога.',
  })
  previewUrl?: string | null;

  @ApiPropertyOptional({
    enum: MusicProvider,
    nullable: true,
    description: 'Каталог, откуда трек. null — наш локальный mp3',
  })
  provider?: MusicProvider | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  externalId?: string | null;

  @ApiProperty({
    example: true,
    description: 'true — играется целиком (наш mp3); false — только 30-сек превью',
  })
  isFullTrack!: boolean;
}

/** Поля Music, которых достаточно для AttachedMusicDto. Селект — в вызывающем сервисе. */
export interface AttachedMusicRow {
  id: number;
  title: string;
  artist: string;
  coverUrl: string;
  url: string;
  provider: MusicProvider | null;
  externalId: string | null;
}

@Injectable()
export class AttachedMusicService {
  private readonly appUrl: string;

  constructor(
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
  }

  toDto(m: AttachedMusicRow | null | undefined): AttachedMusicDto | null {
    if (!m) return null;
    // `keyFromUrl` вернёт ключ, только если url указывает в наш S3 — это тот же
    // вопрос, что задаёт /music/:id/stream перед отдачей файла, поэтому ответ
    // не может разойтись с реальностью.
    const isFullTrack = this.storage.keyFromUrl(m.url) !== null;
    return {
      id: m.id,
      title: m.title,
      artist: m.artist,
      coverUrl: m.coverUrl,
      streamUrl: isFullTrack ? `${this.appUrl}/api/music/${m.id}/stream` : null,
      previewUrl: isFullTrack ? null : m.url,
      provider: m.provider,
      externalId: m.externalId,
      isFullTrack,
    };
  }
}
