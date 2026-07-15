import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessModule } from './common/access/access.module';
import { ChatUtilModule } from './common/chat/chat-util.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { JobsModule } from './jobs/jobs.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { CloseFriendsModule } from './modules/close-friends/close-friends.module';
import { FollowModule } from './modules/follow/follow.module';
import { MusicModule } from './modules/music/music.module';
import { ChatModule } from './modules/chat/chat.module';
import { NotesModule } from './modules/notes/notes.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PostsModule } from './modules/posts/posts.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { StoriesModule } from './modules/stories/stories.module';
import { ProfileModule } from './modules/profile/profile.module';
import { UploadModule } from './modules/upload/upload.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    // По умолчанию 100 req/мин; на auth-роутах будет 5/мин через @Throttle (Фаза 3)
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    StorageModule,
    MailModule,
    AccessModule,
    ChatUtilModule,
    JobsModule,
    HealthModule,
    AuthModule,
    UploadModule,
    UsersModule,
    ProfileModule,
    FollowModule,
    CloseFriendsModule,
    MusicModule,
    PostsModule,
    StoriesModule,
    NotesModule,
    RealtimeModule,
    ChatModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Всё закрыто по умолчанию; открывается точечно через @Public().
    // Именно это закрывает /upload из Фазы 2 — отдельный @UseGuards там не нужен.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
