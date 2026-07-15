import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LiveController } from './live.controller';
import { LiveGateway } from './live.gateway';
import { LiveRealtimeService } from './live-realtime.service';
import { LiveService } from './live.service';
import { LiveKitService } from './livekit/livekit.service';

/** JwtModule — для проверки токена при подключении к namespace /live. */
@Module({
  imports: [JwtModule.register({})],
  controllers: [LiveController],
  providers: [LiveService, LiveKitService, LiveRealtimeService, LiveGateway],
})
export class LiveModule {}
