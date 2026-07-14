import { Module } from '@nestjs/common';
import { BlockGuard } from '../../common/guards/block.guard';
import { PrivacyGuard } from '../../common/guards/privacy.guard';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, BlockGuard, PrivacyGuard],
  exports: [ProfileService],
})
export class ProfileModule {}
