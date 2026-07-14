import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CloseFriendDto, OkMessageDto } from '../follow/dto/follow.dto';
import { CloseFriendsService } from './close-friends.service';

@ApiBearerAuth()
@ApiTags('close-friends')
@Controller('close-friends')
export class CloseFriendsController {
  constructor(private readonly closeFriendsService: CloseFriendsService) {}

  @Get()
  @ApiOperation({ summary: 'Список близких друзей (зелёный круг историй)' })
  @ApiOkResponse({ type: [CloseFriendDto] })
  async list(@CurrentUser('id') userId: string): Promise<CloseFriendDto[]> {
    return this.closeFriendsService.list(userId);
  }

  @Post(':userId')
  @ApiOperation({ summary: 'Добавить в близкие друзья (идемпотентно)' })
  @ApiOkResponse({ type: OkMessageDto })
  async add(
    @CurrentUser('id') userId: string,
    @Param('userId') friendId: string,
  ): Promise<OkMessageDto> {
    return this.closeFriendsService.add(userId, friendId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Убрать из близких друзей' })
  @ApiOkResponse({ type: OkMessageDto })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('userId') friendId: string,
  ): Promise<OkMessageDto> {
    return this.closeFriendsService.remove(userId, friendId);
  }
}
