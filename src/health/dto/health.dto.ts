import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ example: 'ok', enum: ['ok', 'degraded'] })
  status!: 'ok' | 'degraded';

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  database!: 'up' | 'down';

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  redis!: 'up' | 'down';

  @ApiProperty({ example: 'up', enum: ['up', 'down'], description: 'MinIO / S3' })
  storage!: 'up' | 'down';

  @ApiProperty({ example: 12 })
  uptimeSec!: number;

  @ApiProperty({ example: '2026-07-14T10:00:00.000Z' })
  timestamp!: string;
}
