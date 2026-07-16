import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [PostsModule],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
