import { Global, Module } from '@nestjs/common';
import { SocketController } from './socket.controller';
import { SocketService } from './socket.service';

/** @Global — тикеты сжигают оба гейтвея (/rt и /live). */
@Global()
@Module({
  controllers: [SocketController],
  providers: [SocketService],
  exports: [SocketService],
})
export class SocketModule {}
