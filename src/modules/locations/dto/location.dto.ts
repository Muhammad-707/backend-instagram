import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CursorDto } from '../../../common/pagination/cursor.dto';

export class CreateLocationDto {
  @ApiProperty({ example: 'Dushanbe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city!: string;

  @ApiPropertyOptional({ example: 'Sughd' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @ApiPropertyOptional({ example: '734000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  zipCode?: string;

  @ApiProperty({ example: 'Tajikistan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  country!: string;

  @ApiPropertyOptional({ example: 38.5598 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 68.787 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

/** PUT — полная замена. В softclub здесь был 400 (AutoMapper, баг #19); у нас просто работает. */
export class UpdateLocationDto extends CreateLocationDto {}

export class LocationQueryDto extends CursorDto {
  @ApiPropertyOptional({ example: 'dush', description: 'Подстрока по city/state/country' })
  @IsOptional()
  @IsString()
  q?: string;
}

export class LocationDto {
  @ApiProperty({ example: 7 })
  id!: number;

  @ApiProperty({ example: 'Dushanbe' })
  city!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Sughd' })
  state?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '734000' })
  zipCode?: string | null;

  @ApiProperty({ example: 'Tajikistan' })
  country!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 38.5598 })
  lat?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 68.787 })
  lng?: number | null;
}

export class DeletedDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}
