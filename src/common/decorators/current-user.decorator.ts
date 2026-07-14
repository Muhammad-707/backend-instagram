import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** Юзер, положенный в request JwtStrategy.validate(). */
export interface JwtUser {
  id: string;
  userName: string;
  email: string;
  role: string;
}

interface RequestWithUser extends Request {
  user?: JwtUser;
}

/**
 * @CurrentUser() user: JwtUser        — весь юзер
 * @CurrentUser('id') userId: string   — одно поле
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtUser | undefined, ctx: ExecutionContext): JwtUser | string | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = req.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
