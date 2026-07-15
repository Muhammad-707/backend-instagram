import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildCursorPage, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { UserBriefDto } from '../users/dto/users.dto';
import {
  AdminOkDto,
  AdminReportDto,
  AdminReportsQueryDto,
  AdminUserDto,
  AdminUsersQueryDto,
} from './dto/admin.dto';

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

type UserBriefRow = Prisma.UserGetPayload<{ select: typeof USER_BRIEF }>;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(dto: AdminUsersQueryDto): Promise<CursorPage<AdminUserDto>> {
    const q = dto.q?.trim();
    const insensitive = Prisma.QueryMode.insensitive;
    const rows = await this.prisma.user.findMany({
      where: q
        ? {
            OR: [
              { userName: { contains: q, mode: insensitive } },
              { fullName: { contains: q, mode: insensitive } },
              { email: { contains: q, mode: insensitive } },
            ],
          }
        : {},
      select: {
        id: true,
        userName: true,
        fullName: true,
        email: true,
        role: true,
        isVerified: true,
        isPrivate: true,
        isDeleted: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });
    return buildCursorPage(rows, dto.limit, (r) => r.id);
  }

  /** Мягкое удаление — историю не рвём (посты/комменты остаются, но аккаунт скрыт). */
  async deleteUser(id: string): Promise<AdminOkDto> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    await this.prisma.user.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    return { ok: true };
  }

  async listReports(dto: AdminReportsQueryDto): Promise<CursorPage<AdminReportDto>> {
    const where: Prisma.ReportWhereInput =
      dto.filter === 'open'
        ? { resolvedAt: null }
        : dto.filter === 'resolved'
          ? { resolvedAt: { not: null } }
          : {};
    const rows = await this.prisma.report.findMany({
      where,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        resolvedAt: true,
        createdAt: true,
        reporter: { select: USER_BRIEF },
      },
      orderBy: { createdAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });
    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    return {
      ...page,
      items: page.items.map((r) => ({
        id: r.id,
        reporter: this.toBrief(r.reporter),
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        resolvedAt: r.resolvedAt,
        createdAt: r.createdAt,
      })),
    };
  }

  async resolveReport(id: string): Promise<AdminReportDto> {
    const report = await this.prisma.report.findUnique({ where: { id }, select: { id: true } });
    if (!report) throw new NotFoundException('Жалоба не найдена');
    const r = await this.prisma.report.update({
      where: { id },
      data: { resolvedAt: new Date() },
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        resolvedAt: true,
        createdAt: true,
        reporter: { select: USER_BRIEF },
      },
    });
    return {
      id: r.id,
      reporter: this.toBrief(r.reporter),
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      resolvedAt: r.resolvedAt,
      createdAt: r.createdAt,
    };
  }

  private toBrief(u: UserBriefRow): UserBriefDto {
    return {
      id: u.id,
      userName: u.userName,
      fullName: u.fullName,
      avatarUrl: u.profile?.avatarUrl ?? null,
      isVerified: u.isVerified,
      isPrivate: u.isPrivate,
    };
  }
}
