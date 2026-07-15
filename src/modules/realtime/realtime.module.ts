import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

/**
 * @Global — RealtimeService и PresenceService нужны chat, а в Фазе 10 и notifications.
 * JwtModule здесь для проверки токена при socket-подключении.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway, RealtimeService, PresenceService],
  exports: [RealtimeService, PresenceService],
})
export class RealtimeModule {}
