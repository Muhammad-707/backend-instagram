import { Injectable } from '@nestjs/common';
import { PostsService } from '../posts/posts.service';
import { CursorDto } from '../../common/pagination/cursor.dto';
import { FeedDto } from '../posts/dto/post.dto';

@Injectable()
export class FeedService {
  constructor(private readonly postsService: PostsService) {}

  async getFeed(userId: string, dto: CursorDto): Promise<FeedDto> {
    return this.postsService.feed(userId, dto);
  }
}
