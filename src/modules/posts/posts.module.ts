import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService, CommentsService],
  exports: [PostsService, CommentsService],
})
export class PostsModule {}
