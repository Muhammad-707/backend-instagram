import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserBriefDto } from '../users/dto/users.dto';
import { RestrictActionDto, SettingsDto, UpdateSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiBearerAuth()
@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Мои настройки (уведомления, приватность взаимодействий, язык)' })
  @ApiOkResponse({ type: SettingsDto })
  async get(@CurrentUser('id') userId: string): Promise<SettingsDto> {
    return this.settings.get(userId);
  }

  @Put()
  @ApiOperation({
    summary: 'Изменить настройки',
    description:
      'Push/email, кто может отмечать/упоминать/писать/комментировать, GIF в комментариях, ' +
      'репосты историй, скрытые слова, язык. Любое подмножество полей.',
  })
  @ApiOkResponse({ type: SettingsDto })
  async update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSettingsDto,
  ): Promise<SettingsDto> {
    return this.settings.update(userId, dto);
  }

  @Get('restricted')
  @ApiOperation({ summary: 'Аккаунты с ограничениями' })
  @ApiOkResponse({ type: [UserBriefDto] })
  async restricted(@CurrentUser('id') userId: string): Promise<UserBriefDto[]> {
    return this.settings.restrictedList(userId);
  }

  @Post('restricted/:userId')
  @ApiOperation({ summary: 'Ограничить аккаунт' })
  @ApiOkResponse({ type: RestrictActionDto })
  async restrict(
    @CurrentUser('id') userId: string,
    @Param('userId') targetId: string,
  ): Promise<RestrictActionDto> {
    return this.settings.restrict(userId, targetId);
  }

  @Delete('restricted/:userId')
  @ApiOperation({ summary: 'Снять ограничение' })
  @ApiOkResponse({ type: RestrictActionDto })
  async unrestrict(
    @CurrentUser('id') userId: string,
    @Param('userId') targetId: string,
  ): Promise<RestrictActionDto> {
    return this.settings.unrestrict(userId, targetId);
  }
}
