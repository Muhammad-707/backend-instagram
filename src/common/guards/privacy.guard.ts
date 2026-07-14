import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AccessService } from '../access/access.service';
import { JwtUser } from '../decorators/current-user.decorator';

interface RequestWithUser extends Request {
  user?: JwtUser;
  params: Record<string, string>;
}

/**
 * Контент закрытого аккаунта — только принятым подписчикам (иначе 403).
 * Вешается на роуты, отдающие ПОСТЫ/ИСТОРИИ, а не сам профиль:
 * профиль приватного юзера в IG виден всем, иначе некуда нажать «Подписаться».
 */
@Injectable()
export class PrivacyGuard implements CanActivate {
  constructor(private readonly access: AccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const viewerId = req.user?.id;
    const targetId = req.params.userId ?? req.params.id;

    if (!viewerId || !targetId) return true;

    // Внутри — и проверка блокировки, и проверка приватности.
    await this.access.assertCanViewContent(viewerId, targetId);
    return true;
  }
}
