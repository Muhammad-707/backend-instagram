import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CursorPage } from '../../common/pagination/cursor.dto';
import { AdminService } from './admin.service';
import {
  AdminOkDto,
  AdminReportDto,
  AdminReportsQueryDto,
  AdminUserDto,
  AdminUsersQueryDto,
} from './dto/admin.dto';

@ApiBearerAuth()
@ApiTags('admin')
@ApiForbiddenResponse({ description: 'Не ADMIN → 403' })
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'Список пользователей (ADMIN)' })
  @ApiOkResponse({ type: AdminUserDto, isArray: true })
  async listUsers(@Query() dto: AdminUsersQueryDto): Promise<CursorPage<AdminUserDto>> {
    return this.admin.listUsers(dto);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Удалить пользователя (мягко, ADMIN)' })
  @ApiOkResponse({ type: AdminOkDto })
  async deleteUser(@Param('id') id: string): Promise<AdminOkDto> {
    return this.admin.deleteUser(id);
  }

  @Get('reports')
  @ApiOperation({ summary: 'Список жалоб (ADMIN, filter=open|resolved)' })
  @ApiOkResponse({ type: AdminReportDto, isArray: true })
  async listReports(@Query() dto: AdminReportsQueryDto): Promise<CursorPage<AdminReportDto>> {
    return this.admin.listReports(dto);
  }

  @Post('reports/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отметить жалобу решённой (ADMIN)' })
  @ApiOkResponse({ type: AdminReportDto })
  async resolveReport(@Param('id') id: string): Promise<AdminReportDto> {
    return this.admin.resolveReport(id);
  }
}
