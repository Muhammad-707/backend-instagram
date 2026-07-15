import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { NotificationDto, OkDto, ProfileViewDto, UnreadCountDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiBearerAuth()
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Лента уведомлений (cursor, с группировкой)',
    description: '«user1 и ещё 5 оценили вашу публикацию» — лайки одной цели схлопываются.',
  })
  @ApiOkResponse({ type: [NotificationDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<NotificationDto>> {
    return this.notificationsService.list(userId, dto);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Количество непрочитанных' })
  @ApiOkResponse({ type: UnreadCountDto })
  async unreadCount(@CurrentUser('id') userId: string): Promise<UnreadCountDto> {
    return this.notificationsService.unreadCount(userId);
  }

  @Get('profile-views')
  @ApiOperation({ summary: 'Кто заходил в твой профиль' })
  @ApiOkResponse({ type: [ProfileViewDto] })
  async profileViews(
    @CurrentUser('id') userId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<ProfileViewDto>> {
    return this.notificationsService.profileViews(userId, dto);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Пометить прочитанным (всю группу)' })
  @ApiOkResponse({ type: OkDto })
  async markRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OkDto> {
    return this.notificationsService.markRead(userId, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Пометить всё прочитанным' })
  @ApiOkResponse({ type: OkDto })
  async markAllRead(@CurrentUser('id') userId: string): Promise<OkDto> {
    return this.notificationsService.markAllRead(userId);
  }
}
