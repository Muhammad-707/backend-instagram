import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AccessService } from '../access/access.service';
import { JwtUser } from '../decorators/current-user.decorator';

interface RequestWithUser extends Request {
  user?: JwtUser;
  params: Record<string, string>;
}

/**
 * Заблокированный не видит профиль и не пишет → 403.
 * Цель берём из :userId / :id в пути. Логика — в AccessService, чтобы guard и сервисы
 * не разошлись в понимании «кто кого заблокировал».
 */
@Injectable()
export class BlockGuard implements CanActivate {
  constructor(private readonly access: AccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const viewerId = req.user?.id;
    const targetId = req.params.userId ?? req.params.id;

    // Нет юзера (публичный роут) или нет цели в пути — guard'у нечего проверять.
    if (!viewerId || !targetId) return true;

    await this.access.assertNotBlocked(viewerId, targetId);
    return true;
  }
}
