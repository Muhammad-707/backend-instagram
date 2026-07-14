import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  userName: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'change_me_access_secret'),
    });
  }

  /**
   * Ходим в БД на каждом запросе намеренно: иначе удалённый или забаненный юзер
   * продолжал бы работать до истечения access-токена (15 мин).
   */
  async validate(payload: AccessTokenPayload): Promise<JwtUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, userName: true, email: true, role: true, isDeleted: true },
    });
    if (!user || user.isDeleted) {
      throw new UnauthorizedException('Пользователь не найден или удалён');
    }
    return { id: user.id, userName: user.userName, email: user.email, role: user.role };
  }
}
