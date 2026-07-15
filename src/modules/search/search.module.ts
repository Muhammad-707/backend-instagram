import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Импортирует PostsModule ради PostsService.explore — движок сетки Explore и поиска по хэштегу. */
@Module({
  imports: [PostsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
