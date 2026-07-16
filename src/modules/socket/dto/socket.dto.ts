import { ApiProperty } from '@nestjs/swagger';

export class SocketTicketDto {
  @ApiProperty({
    example: '3f1c0a5e-8b2d-4c7a-9f10-5e6d7c8b9a01',
    description: 'Одноразовый тикет для io(url, { auth: { ticket } })',
  })
  ticket!: string;

  @ApiProperty({ example: 30, description: 'Сколько секунд тикет действителен' })
  expiresInSec!: number;
}
