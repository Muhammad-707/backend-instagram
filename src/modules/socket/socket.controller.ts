import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SocketTicketDto } from './dto/socket.dto';
import { SocketService } from './socket.service';

@ApiBearerAuth()
@ApiTags('socket')
@Controller('socket')
export class SocketController {
  constructor(private readonly socket: SocketService) {}

  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Одноразовый тикет для подключения сокета',
    description:
      'Обычный HTTP-запрос: httpOnly-кука с access-токеном сюда доедет, а в cross-origin ' +
      'сокет — нет. Тикет одноразовый, живёт 30 сек, сжигается при первом же подключении: ' +
      'io(url, { auth: { ticket } }). Повторный или просроченный → disconnect. ' +
      'Подключение с `auth.token` тоже работает — для серверных клиентов, у которых токен есть.',
  })
  @ApiOkResponse({ type: SocketTicketDto })
  async ticket(@CurrentUser('id') userId: string): Promise<SocketTicketDto> {
    return this.socket.issue(userId);
  }
}
