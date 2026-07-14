import { Module } from '@nestjs/common';
import { CloseFriendsController } from './close-friends.controller';
import { CloseFriendsService } from './close-friends.service';

@Module({
  controllers: [CloseFriendsController],
  providers: [CloseFriendsService],
  exports: [CloseFriendsService],
})
export class CloseFriendsModule {}
