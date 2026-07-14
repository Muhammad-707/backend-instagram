import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BlockGuard } from '../../common/guards/block.guard';
import { CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import {
  BlockedUserDto,
  FollowerDto,
  FollowRequestDto,
  FollowResultDto,
  OkMessageDto,
} from './dto/follow.dto';
import { FollowService } from './follow.service';

@ApiBearerAuth()
@ApiTags('follow')
@Controller('follow')
export class FollowController {
  constructor(private readonly followService: FollowService) {}

  // Конкретные пути — до ':userId', иначе он перехватит 'requests' и 'blocked'.

  @Get('requests')
  @ApiOperation({ summary: 'Входящие заявки на подписку (для закрытого аккаунта)' })
  @ApiOkResponse({ type: [FollowRequestDto] })
  async requests(
    @CurrentUser('id') userId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<FollowRequestDto>> {
    return this.followService.requests(userId, dto);
  }

  @Post('requests/:id/accept')
  @ApiOperation({ summary: 'Принять заявку → подписчик видит контент' })
  @ApiOkResponse({ type: OkMessageDto })
  @ApiForbiddenResponse({ description: 'Заявка адресована не вам' })
  async accept(
    @CurrentUser('id') userId: string,
    @Param('id') requestId: string,
  ): Promise<OkMessageDto> {
    return this.followService.accept(userId, requestId);
  }

  @Post('requests/:id/decline')
  @ApiOperation({ summary: 'Отклонить заявку' })
  @ApiOkResponse({ type: OkMessageDto })
  async decline(
    @CurrentUser('id') userId: string,
    @Param('id') requestId: string,
  ): Promise<OkMessageDto> {
    return this.followService.decline(userId, requestId);
  }

  @Get('blocked')
  @ApiOperation({ summary: 'Список заблокированных мной' })
  @ApiOkResponse({ type: [BlockedUserDto] })
  async blocked(
    @CurrentUser('id') userId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<BlockedUserDto>> {
    return this.followService.blocked(userId, dto);
  }

  @Delete('followers/:userId')
  @ApiOperation({ summary: 'Удалить подписчика (убирает ЕГО подписку на меня)' })
  @ApiOkResponse({ type: OkMessageDto })
  async removeFollower(
    @CurrentUser('id') userId: string,
    @Param('userId') followerId: string,
  ): Promise<OkMessageDto> {
    return this.followService.removeFollower(userId, followerId);
  }

  // ─────────── блокировки ───────────
  // BlockGuard тут НЕ вешаем: заблокировать/разблокировать нужно уметь именно того,
  // с кем уже есть блокировка.

  @Post(':userId/block')
  @ApiOperation({
    summary: 'Заблокировать',
    description: 'Рвёт подписки в обе стороны и убирает из близких друзей.',
  })
  @ApiOkResponse({ type: OkMessageDto })
  async block(
    @CurrentUser('id') userId: string,
    @Param('userId') targetId: string,
  ): Promise<OkMessageDto> {
    return this.followService.block(userId, targetId);
  }

  @Delete(':userId/block')
  @ApiOperation({ summary: 'Разблокировать (подписки НЕ восстанавливаются)' })
  @ApiOkResponse({ type: OkMessageDto })
  async unblock(
    @CurrentUser('id') userId: string,
    @Param('userId') targetId: string,
  ): Promise<OkMessageDto> {
    return this.followService.unblock(userId, targetId);
  }

  // ─────────── подписка ───────────

  @Get(':userId/followers')
  @UseGuards(BlockGuard)
  @ApiOperation({ summary: 'Подписчики (у закрытого аккаунта — только своим)' })
  @ApiOkResponse({ type: [FollowerDto] })
  @ApiForbiddenResponse({ description: 'Блокировка или закрытый аккаунт' })
  async followers(
    @CurrentUser('id') viewerId: string,
    @Param('userId') targetId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<FollowerDto>> {
    return this.followService.followers(viewerId, targetId, dto);
  }

  @Get(':userId/following')
  @UseGuards(BlockGuard)
  @ApiOperation({ summary: 'Подписки (у закрытого аккаунта — только своим)' })
  @ApiOkResponse({ type: [FollowerDto] })
  async following(
    @CurrentUser('id') viewerId: string,
    @Param('userId') targetId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<FollowerDto>> {
    return this.followService.following(viewerId, targetId, dto);
  }

  @Post(':userId')
  @UseGuards(BlockGuard)
  @ApiOperation({
    summary: 'Подписаться',
    description: 'Публичный → ACCEPTED сразу. Приватный → PENDING + уведомление FOLLOW_REQUEST.',
  })
  @ApiOkResponse({ type: FollowResultDto })
  @ApiForbiddenResponse({ description: 'Пользователь вас заблокировал' })
  async follow(
    @CurrentUser('id') userId: string,
    @Param('userId') targetId: string,
  ): Promise<FollowResultDto> {
    return this.followService.follow(userId, targetId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Отписаться (идемпотентно)' })
  @ApiOkResponse({ type: OkMessageDto })
  async unfollow(
    @CurrentUser('id') userId: string,
    @Param('userId') targetId: string,
  ): Promise<OkMessageDto> {
    return this.followService.unfollow(userId, targetId);
  }
}
