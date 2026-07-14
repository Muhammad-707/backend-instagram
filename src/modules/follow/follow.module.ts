import { Module } from '@nestjs/common';
import { BlockGuard } from '../../common/guards/block.guard';
import { PrivacyGuard } from '../../common/guards/privacy.guard';
import { FollowController } from './follow.controller';
import { FollowService } from './follow.service';

@Module({
  controllers: [FollowController],
  providers: [FollowService, BlockGuard, PrivacyGuard],
  exports: [FollowService],
})
export class FollowModule {}
