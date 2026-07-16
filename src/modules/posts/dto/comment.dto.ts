import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { UserBriefDto } from '../../users/dto/users.dto';

export const COMMENT_MAX = 2200;

export class CreateCommentDto {
  @ApiProperty({ example: 'Отличное фото! @eraj', maxLength: COMMENT_MAX })
  @IsString()
  @IsNotEmpty({ message: 'Комментарий не может быть пустым' })
  @MaxLength(COMMENT_MAX)
  text!: string;
}

export class CommentDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ example: 'Отличное фото!' })
  text!: string;

  @ApiProperty({
    type: UserBriefDto,
    description: 'Автор комментария — НИКОГДА не null (баг softclub #6)',
  })
  author!: UserBriefDto;

  @ApiPropertyOptional({ type: Number, example: null, nullable: true, description: 'id родителя — для ответов' })
  parentId?: number | null;

  @ApiProperty({ example: 3 })
  likesCount!: number;

  @ApiProperty({ example: 1, description: 'Сколько ответов на этот комментарий' })
  repliesCount!: number;

  @ApiProperty({ example: false, description: 'Лайкнул ли Я' })
  isLiked!: boolean;

  @ApiProperty({
    example: true,
    description: 'Могу ли я удалить: свой комментарий или комментарий под своим постом',
  })
  canDelete!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

export class CommentLikeToggleDto {
  @ApiProperty({ example: true })
  liked!: boolean;

  @ApiProperty({ example: 4 })
  likesCount!: number;
}

export class DeletedDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}
