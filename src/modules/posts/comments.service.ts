import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotifType, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { buildCursorPage, CursorDto, CursorPage } from '../../common/pagination/cursor.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import { UserBriefDto } from '../users/dto/users.dto';
import { parseMentions } from './content-parser';
import { CommentDto, CommentLikeToggleDto, DeletedDto } from './dto/comment.dto';

const USER_BRIEF = {
  id: true,
  userName: true,
  fullName: true,
  isVerified: true,
  isPrivate: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect;

/**
 * Автор ВСЕГДА подтягивается вместе с комментарием (баг softclub #6: приходил null).
 * Это не include «на всякий случай» — без автора комментарий бесполезен фронту.
 */
const COMMENT_SELECT = {
  id: true,
  text: true,
  parentId: true,
  createdAt: true,
  userId: true,
  postId: true,
  user: { select: USER_BRIEF },
  _count: { select: { likes: true, replies: true } },
} satisfies Prisma.CommentSelect;

type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly events: EventEmitter2,
  ) {}

  async add(userId: string, postId: number, text: string, parentId?: number): Promise<CommentDto> {
    const post = await this.loadVisiblePost(userId, postId);

    if (parentId !== undefined) {
      const parent = await this.prisma.comment.findUnique({
        where: { id: parentId },
        select: { postId: true, parentId: true, userId: true },
      });
      if (!parent || parent.postId !== postId) {
        throw new NotFoundException('Комментарий, на который вы отвечаете, не найден');
      }
      // Ветку не углубляем: в IG ответы — один уровень. Ответ на ответ прикрепляем
      // к тому же корневому комментарию, иначе дерево станет бесконечным.
      if (parent.parentId !== null) parentId = parent.parentId;
    }

    const comment = await this.prisma.comment.create({
      data: { postId, userId, text, parentId: parentId ?? null },
      select: COMMENT_SELECT,
    });

    // Автору поста — «прокомментировал», автору родительского комментария — «ответил».
    if (parentId !== undefined) {
      const parent = await this.prisma.comment.findUnique({
        where: { id: parentId },
        select: { userId: true },
      });
      if (parent) {
        this.notify(parent.userId, userId, NotifType.REPLY_COMMENT, {
          postId,
          commentId: comment.id,
        });
      }
    } else {
      this.notify(post.userId, userId, NotifType.COMMENT_POST, {
        postId,
        commentId: comment.id,
      });
    }

    await this.linkMentions(comment.id, postId, userId, text);

    return this.toDto(comment, new Set(), post.userId, userId);
  }

  /** Ответ на комментарий: postId берём у родителя — клиенту его знать не нужно. */
  async reply(userId: string, parentId: number, text: string): Promise<CommentDto> {
    const parent = await this.prisma.comment.findUnique({
      where: { id: parentId },
      select: { postId: true },
    });
    if (!parent) throw new NotFoundException('Комментарий не найден');

    return this.add(userId, parent.postId, text, parentId);
  }

  /** Ответы на конкретный комментарий. */
  async listReplies(
    userId: string,
    parentId: number,
    dto: CursorDto,
  ): Promise<CursorPage<CommentDto>> {
    const parent = await this.prisma.comment.findUnique({
      where: { id: parentId },
      select: { postId: true },
    });
    if (!parent) throw new NotFoundException('Комментарий не найден');

    return this.list(userId, parent.postId, dto, parentId);
  }

  /** Список комментариев: корневые + счётчик ответов. Ответы — отдельным запросом по parentId. */
  async list(
    userId: string,
    postId: number,
    dto: CursorDto,
    parentId?: number,
  ): Promise<CursorPage<CommentDto>> {
    const post = await this.loadVisiblePost(userId, postId);

    const rows = await this.prisma.comment.findMany({
      where: {
        postId,
        // Без parentId отдаём только корневые — иначе ответы дублировались бы в ленте.
        parentId: parentId ?? null,
      },
      select: COMMENT_SELECT,
      orderBy: { id: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: Number(dto.cursor) }, skip: 1 } : {}),
    });

    const page = buildCursorPage(rows, dto.limit, (r) => r.id);
    const liked = await this.likedIds(
      userId,
      page.items.map((r) => r.id),
    );

    return {
      ...page,
      items: page.items.map((r) => this.toDto(r, liked, post.userId, userId)),
    };
  }

  /**
   * Баг softclub #17: delete-message не проверял владельца — удалить можно было чужое.
   * Здесь: удалять вправе автор комментария ИЛИ автор поста (как в IG — хозяин поста
   * чистит комментарии у себя). Все остальные → 403.
   */
  async remove(userId: string, commentId: number): Promise<DeletedDto> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { userId: true, post: { select: { userId: true } } },
    });
    if (!comment) throw new NotFoundException('Комментарий не найден');

    const isAuthor = comment.userId === userId;
    const isPostOwner = comment.post.userId === userId;
    if (!isAuthor && !isPostOwner) {
      throw new ForbiddenException('Можно удалить только свой комментарий');
    }

    // Ответы уйдут каскадом (onDelete: Cascade на parentId).
    await this.prisma.comment.delete({ where: { id: commentId } });
    return { deleted: true };
  }

  async toggleLike(userId: string, commentId: number): Promise<CommentLikeToggleDto> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { userId: true, postId: true, post: { select: { userId: true } } },
    });
    if (!comment) throw new NotFoundException('Комментарий не найден');
    await this.access.assertCanViewContent(userId, comment.post.userId);

    const existing = await this.prisma.commentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.commentLike.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.commentLike.create({ data: { commentId, userId } });
      this.notify(comment.userId, userId, NotifType.LIKE_COMMENT, {
        postId: comment.postId,
        commentId,
      });
    }

    const likesCount = await this.prisma.commentLike.count({ where: { commentId } });
    return { liked: !existing, likesCount };
  }

  // ─────────────── helpers ───────────────

  private async loadVisiblePost(userId: string, postId: number): Promise<{ userId: string }> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { userId: true },
    });
    if (!post) throw new NotFoundException('Публикация не найдена');
    await this.access.assertCanViewContent(userId, post.userId);
    return post;
  }

  private async likedIds(userId: string, commentIds: number[]): Promise<Set<number>> {
    if (commentIds.length === 0) return new Set();
    const rows = await this.prisma.commentLike.findMany({
      where: { userId, commentId: { in: commentIds } },
      select: { commentId: true },
    });
    return new Set(rows.map((r) => r.commentId));
  }

  private async linkMentions(
    commentId: number,
    postId: number,
    actorId: string,
    text: string,
  ): Promise<void> {
    const userNames = parseMentions(text);
    if (userNames.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { userName: { in: userNames }, isDeleted: false },
      select: { id: true },
    });

    for (const u of users) {
      await this.prisma.mention.create({ data: { commentId, userId: u.id } });
      this.notify(u.id, actorId, NotifType.MENTION, { postId, commentId });
    }
  }

  private notify(
    userId: string,
    actorId: string,
    type: NotifType,
    extra: { postId?: number; commentId?: number },
  ): void {
    this.events.emit(NOTIFY_EVENT, { userId, actorId, type, ...extra } satisfies NotifyPayload);
  }

  private toDto(
    row: CommentRow,
    liked: Set<number>,
    postOwnerId: string,
    viewerId: string,
  ): CommentDto {
    const u = row.user;
    return {
      id: row.id,
      text: row.text,
      // Автор — всегда объект, никогда null.
      author: {
        id: u.id,
        userName: u.userName,
        fullName: u.fullName,
        avatarUrl: u.profile?.avatarUrl ?? null,
        isVerified: u.isVerified,
        isPrivate: u.isPrivate,
      } satisfies UserBriefDto,
      parentId: row.parentId,
      likesCount: row._count.likes,
      repliesCount: row._count.replies,
      isLiked: liked.has(row.id),
      canDelete: row.userId === viewerId || postOwnerId === viewerId,
      createdAt: row.createdAt,
    };
  }
}
