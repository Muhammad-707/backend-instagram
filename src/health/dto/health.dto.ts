import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({
    description:
      'Сабаби хатогии пайваст барои ҳар сервиси афтода. Танҳо вақте ҳаст, ки чизе «down» бошад. ' +
      'Парол, хост ва IP пеш аз ирсол пок карда мешаванд.',
    example: {
      database: "Can't reach database server at `***`",
      redis: 'connect ECONNREFUSED ***',
    },
    additionalProperties: { type: 'string' },
  })
  reasons?: Record<string, string>;
}
