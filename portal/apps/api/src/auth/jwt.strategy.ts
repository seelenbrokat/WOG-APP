import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret'),
    });
  }

  async validate(payload: { sub: string }): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { mandantAccess: true },
    });
    if (!user || !user.active) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      customerId: user.customerId,
      mandantIds: user.mandantAccess.map((a) => a.mandantId),
    };
  }
}
