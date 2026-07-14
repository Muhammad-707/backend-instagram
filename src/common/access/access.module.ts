import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';

/** @Global — блокировки и приватность нужны почти каждому модулю. */
@Global()
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
