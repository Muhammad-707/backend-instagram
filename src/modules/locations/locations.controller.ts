import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CursorPage } from '../../common/pagination/cursor.dto';
import {
  CreateLocationDto,
  DeletedDto,
  LocationDto,
  LocationQueryDto,
  UpdateLocationDto,
} from './dto/location.dto';
import { LocationsService } from './locations.service';

@ApiBearerAuth()
@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @ApiOperation({ summary: 'Список локаций (cursor, поиск по q)' })
  @ApiOkResponse({ type: LocationDto, isArray: true })
  async list(@Query() dto: LocationQueryDto): Promise<CursorPage<LocationDto>> {
    return this.locations.list(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Одна локация' })
  @ApiOkResponse({ type: LocationDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<LocationDto> {
    return this.locations.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Создать локацию' })
  @ApiCreatedResponse({ type: LocationDto })
  async create(@Body() dto: CreateLocationDto): Promise<LocationDto> {
    return this.locations.create(dto);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Обновить локацию (полная замена)',
    description: 'В softclub здесь был 400 (AutoMapper, баг #19). У нас просто работает → 200.',
  })
  @ApiOkResponse({ type: LocationDto })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLocationDto,
  ): Promise<LocationDto> {
    return this.locations.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить локацию (у постов locationId → null)' })
  @ApiOkResponse({ type: DeletedDto })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<DeletedDto> {
    return this.locations.remove(id);
  }
}
