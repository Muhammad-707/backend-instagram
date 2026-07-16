import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildCursorPage, CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PostDto } from '../posts/dto/post.dto';
import { PostsService } from '../posts/posts.service';
import {
  CreateLocationDto,
  DeletedDto,
  LocationDto,
  LocationQueryDto,
  UpdateLocationDto,
} from './dto/location.dto';

const LOCATION_SELECT = {
  id: true,
  city: true,
  state: true,
  zipCode: true,
  country: true,
  lat: true,
  lng: true,
} satisfies Prisma.LocationSelect;

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posts_: PostsService,
  ) {}

  async list(dto: LocationQueryDto): Promise<CursorPage<LocationDto>> {
    const q = dto.q?.trim();
    const insensitive = Prisma.QueryMode.insensitive;
    const rows = await this.prisma.location.findMany({
      where: q
        ? {
            OR: [
              { city: { contains: q, mode: insensitive } },
              { state: { contains: q, mode: insensitive } },
              { country: { contains: q, mode: insensitive } },
            ],
          }
        : {},
      select: LOCATION_SELECT,
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });
    return buildCursorPage(rows, dto.limit, (r) => r.id);
  }

  async get(id: number): Promise<LocationDto> {
    const row = await this.prisma.location.findUnique({ where: { id }, select: LOCATION_SELECT });
    if (!row) throw new NotFoundException('Локация не найдена');
    return row;
  }

  /**
   * Лента локации. Всю выдачу отдаём в PostsService.explore() вместо своего
   * findMany: там уже живут правила приватности и блокировок. Свой запрос
   * означал бы вторую копию этих правил, которая рано или поздно разъедется
   * с оригиналом — и приватные посты утекли бы именно здесь.
   */
  async posts(viewerId: string, id: number, dto: CursorDto): Promise<CursorPage<PostDto>> {
    await this.get(id); // 404, если локации нет — иначе отдали бы пустой список
    return this.posts_.explore(viewerId, { ...dto, locationId: id });
  }

  async create(dto: CreateLocationDto): Promise<LocationDto> {
    return this.prisma.location.create({ data: dto, select: LOCATION_SELECT });
  }

  /** Полная замена. Существование проверяем явно — иначе Prisma кинет P2025 (500-подобно). */
  async update(id: number, dto: UpdateLocationDto): Promise<LocationDto> {
    await this.ensureExists(id);
    return this.prisma.location.update({
      where: { id },
      data: {
        city: dto.city,
        state: dto.state ?? null,
        zipCode: dto.zipCode ?? null,
        country: dto.country,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
      },
      select: LOCATION_SELECT,
    });
  }

  async remove(id: number): Promise<DeletedDto> {
    await this.ensureExists(id);
    // Location.onDelete = SetNull у posts/profiles — удаление не рвёт публикации.
    await this.prisma.location.delete({ where: { id } });
    return { deleted: true };
  }

  private async ensureExists(id: number): Promise<void> {
    const found = await this.prisma.location.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Локация не найдена');
  }
}
