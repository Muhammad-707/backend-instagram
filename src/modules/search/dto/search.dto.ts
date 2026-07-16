import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { UserBriefDto } from '../../users/dto/users.dto';

export class SearchQueryDto {
  @ApiProperty({
    example: 'er',
    description: 'Строка поиска. Подстрока: «er» найдёт eraj, amERica, chessmastER.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q!: string;
}

export class HashtagDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ example: 'tj' })
  name!: string;

  @ApiProperty({ example: 128, description: 'Сколько постов с этим хэштегом' })
  postsCount!: number;
}

export class LocationBriefDto {
  @ApiProperty({ example: 7 })
  id!: number;

  @ApiProperty({ example: 'Dushanbe' })
  city!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  state?: string | null;

  @ApiProperty({ example: 'Tajikistan' })
  country!: string;
}

/** Один ответ на /search — три группы сразу (softclub отдавал только аккаунты). */
export class SearchResultDto {
  @ApiProperty({ type: [UserBriefDto] })
  users!: UserBriefDto[];

  @ApiProperty({ type: [HashtagDto] })
  hashtags!: HashtagDto[];

  @ApiProperty({ type: [LocationBriefDto] })
  locations!: LocationBriefDto[];
}

export class TopResultDto {
  @ApiProperty({ type: [HashtagDto], description: 'Популярные хэштеги за последние 7 дней' })
  hashtags!: HashtagDto[];

  @ApiProperty({
    type: [UserBriefDto],
    description: 'Аккаунты недели — макс. прирост подписчиков за 7 дней',
  })
  accounts!: UserBriefDto[];
}
