import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { UploadedFile } from '../../storage/storage.types';
import { DeletedKeyDto, UploadedMediaDto } from './dto/upload-result.dto';
import { UploadService } from './upload.service';

const MAX_FILES = 10;
/** Жёсткий предохранитель Multer — по самому большому лимиту (видео 100 МБ, ТЗ §6). */
const HARD_LIMIT_BYTES = 100 * 1024 * 1024;

// Защищён глобальным JwtAuthGuard (app.module): всё закрыто, кроме явного @Public().
// Аноним получит 401 — TODO Фазы 2 закрыт.
@ApiBearerAuth()
@ApiTags('upload')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @ApiOperation({
    summary: 'Загрузить до 10 файлов (фото / видео / аудио)',
    description:
      'Тип определяется по magic bytes, а не по расширению. Фото → webp (EXIF вырезается), ' +
      'видео → постер кадром 0.1 с + длительность. Лимиты: фото 10 МБ, видео 100 МБ, аудио 20 МБ.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOkResponse({ type: [UploadedMediaDto] })
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: HARD_LIMIT_BYTES, files: MAX_FILES },
    }),
  )
  async upload(@UploadedFiles() files: UploadedFile[]): Promise<UploadedMediaDto[]> {
    return this.uploadService.uploadMany(files);
  }

  @Delete('*key')
  @ApiOperation({ summary: 'Удалить файл по ключу' })
  @ApiParam({
    name: 'key',
    example: 'images/2026/07/6f1c9e1a.webp',
    description: 'Ключ объекта из ответа POST /upload (со слешами)',
  })
  @ApiOkResponse({ type: DeletedKeyDto })
  async remove(@Param('key') key: string | string[]): Promise<DeletedKeyDto> {
    // Express 5: splat-параметр приходит массивом сегментов пути — собираем ключ обратно.
    const normalized = Array.isArray(key) ? key.join('/') : key;
    if (!normalized) throw new BadRequestException('Ключ файла не указан');
    await this.uploadService.remove(normalized);
    return { key: normalized, deleted: true };
  }
}
