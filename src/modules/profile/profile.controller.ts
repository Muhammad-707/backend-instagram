import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BlockGuard } from '../../common/guards/block.guard';
import { PrivacyGuard } from '../../common/guards/privacy.guard';
import { CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { UploadedFile as MulterFile } from '../../storage/storage.types';
import {
  ActivityItemDto,
  ActivityQueryDto,
  AvatarDto,
  CollectionDto,
  IsFollowingDto,
  MusicBriefDto,
  OtherProfileDto,
  PostBriefDto,
  ProfileDto,
  UpdatePrivacyDto,
  UpdateProfileDto,
} from './dto/profile.dto';
import { ProfileService } from './profile.service';

const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

@ApiBearerAuth()
@ApiTags('profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // Конкретные пути — до ':userId', иначе 'me' и 'favorites' попадут в него как id.

  @Get('me')
  @ApiOperation({ summary: 'Мой профиль' })
  @ApiOkResponse({ type: ProfileDto })
  async me(@CurrentUser('id') userId: string): Promise<ProfileDto> {
    return this.profileService.me(userId);
  }

  @Get('me/collections')
  @ApiOperation({
    summary: 'Мои коллекции сохранённого',
    description:
      'Имя коллекции — то же значение, что принимает POST /posts/{id}/favorite в поле ' +
      '`collection`, поэтому список можно показывать выбором вместо ввода руками. ' +
      'Посты вне коллекций сюда не входят — они в /profile/favorites.',
  })
  @ApiOkResponse({ type: [CollectionDto] })
  async collections(@CurrentUser('id') userId: string): Promise<CollectionDto[]> {
    return this.profileService.collections(userId);
  }

  @Get('favorites')
  @ApiOperation({ summary: 'Сохранённое (только своё)' })
  @ApiOkResponse({ type: [PostBriefDto] })
  async favorites(
    @CurrentUser('id') userId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<PostBriefDto>> {
    return this.profileService.favorites(userId, dto);
  }

  @Get('me/reposts')
  @ApiOperation({ summary: 'Мои репосты' })
  @ApiOkResponse({ type: [PostBriefDto] })
  async reposts(
    @CurrentUser('id') userId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<PostBriefDto>> {
    return this.profileService.reposts(userId, dto);
  }

  @Get('me/saved-music')
  @ApiOperation({ summary: 'Сохранённая музыка' })
  @ApiOkResponse({ type: [MusicBriefDto] })
  async savedMusic(@CurrentUser('id') userId: string): Promise<MusicBriefDto[]> {
    return this.profileService.savedMusic(userId);
  }

  @Get('me/activity')
  @ApiOperation({
    summary: 'Ваши действия',
    description:
      'Лайки, комментарии, просмотры и поисковые запросы одним списком, с фильтром по дате.',
  })
  @ApiOkResponse({ type: [ActivityItemDto] })
  async activity(
    @CurrentUser('id') userId: string,
    @Query() dto: ActivityQueryDto,
  ): Promise<ActivityItemDto[]> {
    return this.profileService.activity(userId, dto);
  }

  @Put()
  @ApiOperation({
    summary: 'Изменить профиль',
    description: 'about ≤150, website, gender (симметричный enum), occupation, dob, флаги.',
  })
  @ApiOkResponse({ type: ProfileDto })
  async update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileDto> {
    return this.profileService.update(userId, dto);
  }

  @Put('privacy')
  @ApiOperation({ summary: 'Закрытый аккаунт вкл/выкл' })
  @ApiOkResponse({ type: ProfileDto })
  async privacy(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePrivacyDto,
  ): Promise<ProfileDto> {
    return this.profileService.updatePrivacy(userId, dto.isPrivate);
  }

  @Put('avatar')
  @ApiOperation({ summary: 'Загрузить аватар' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOkResponse({ type: AvatarDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: AVATAR_MAX_BYTES },
    }),
  )
  async setAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: MulterFile | undefined,
  ): Promise<AvatarDto> {
    if (!file) throw new BadRequestException('Не передан файл (поле «file»)');
    return this.profileService.setAvatar(userId, file);
  }

  @Delete('avatar')
  @ApiOperation({
    summary: 'Удалить аватар',
    description: 'Обнуляет только Profile.avatarUrl. Логин НЕ ломается (баг softclub #2).',
  })
  @ApiOkResponse({ type: AvatarDto })
  async deleteAvatar(@CurrentUser('id') userId: string): Promise<AvatarDto> {
    return this.profileService.deleteAvatar(userId);
  }

  // ─────────── чужой профиль ───────────

  // BlockGuard — на сам профиль (заблокированный не видит его вовсе).
  // PrivacyGuard — на КОНТЕНТ: у закрытого аккаунта посты видны только принятым подписчикам.
  @Get(':userId')
  @UseGuards(BlockGuard)
  @ApiOperation({
    summary: 'Профиль пользователя',
    description: '+ isFollowing / isFollowedBy / isBlocked / hasRequestPending / canViewContent',
  })
  @ApiOkResponse({ type: OtherProfileDto })
  async byId(
    @CurrentUser('id') viewerId: string,
    @Param('userId') targetId: string,
  ): Promise<OtherProfileDto> {
    return this.profileService.byId(viewerId, targetId);
  }

  @Get(':userId/is-following')
  @ApiOperation({ summary: 'Подписан ли я на этого пользователя' })
  @ApiOkResponse({ type: IsFollowingDto })
  async isFollowing(
    @CurrentUser('id') viewerId: string,
    @Param('userId') targetId: string,
  ): Promise<IsFollowingDto> {
    return this.profileService.isFollowing(viewerId, targetId);
  }

  @Get(':userId/posts')
  @UseGuards(PrivacyGuard)
  @ApiOperation({ summary: 'Публикации пользователя (закрытый аккаунт → 403)' })
  @ApiOkResponse({ type: [PostBriefDto] })
  async posts(
    @CurrentUser('id') viewerId: string,
    @Param('userId') targetId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<PostBriefDto>> {
    return this.profileService.posts(viewerId, targetId, dto, false);
  }

  @Get(':userId/reels')
  @UseGuards(PrivacyGuard)
  @ApiOperation({ summary: 'Reels пользователя (закрытый аккаунт → 403)' })
  @ApiOkResponse({ type: [PostBriefDto] })
  async reels(
    @CurrentUser('id') viewerId: string,
    @Param('userId') targetId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<PostBriefDto>> {
    return this.profileService.posts(viewerId, targetId, dto, true);
  }

  @Get(':userId/tagged')
  @UseGuards(PrivacyGuard)
  @ApiOperation({ summary: 'Отмеченные публикации (закрытый аккаунт → 403)' })
  @ApiOkResponse({ type: [PostBriefDto] })
  async tagged(
    @CurrentUser('id') viewerId: string,
    @Param('userId') targetId: string,
    @Query() dto: CursorDto,
  ): Promise<CursorPage<PostBriefDto>> {
    return this.profileService.tagged(viewerId, targetId, dto);
  }
}
