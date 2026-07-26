import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.types';
import { DriverAuthUser } from '../fahrer/fahrer.types';

type JwtPayload = {
  sub: string;
  typ?: string;
  role?: string;
  organizationId?: string;
  tenant?: string;
  driverId?: string;
  driverTelematicsId?: string;
  vehicleId?: string;
  vehicleSoloplanId?: string;
  firstName?: string | null;
  lastName?: string | null;
  licensePlate?: string | null;
};

/**
 * Portal JwtStrategy + Fahrer (typ=driver).
 * Bei Portal-Updates: nur Driver-Zweig mergen, Portal-User-Felder behalten.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        config.get<string>('JWT_SECRET') ||
        (process.env.NODE_ENV === 'production' ? '' : 'dev-secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser | DriverAuthUser | null> {
    if (payload.typ === 'driver') {
      const driver = await this.prisma.driver.findUnique({
        where: { id: payload.driverId || payload.sub },
      });
      if (!driver || !driver.active) {
        throw new UnauthorizedException('Fahrer ungültig');
      }
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: payload.vehicleId! },
      });
      if (!vehicle || !vehicle.active) {
        throw new UnauthorizedException('Fahrzeug ungültig');
      }
      const result: DriverAuthUser = {
        typ: 'driver',
        id: driver.id,
        organizationId: payload.organizationId || driver.organizationId,
        tenant: payload.tenant || 'wog',
        driverId: driver.id,
        driverTelematicsId: driver.telematicsId,
        vehicleId: vehicle.id,
        vehicleSoloplanId: vehicle.soloplanVehicleId,
        firstName: driver.firstName,
        lastName: driver.lastName,
        licensePlate: vehicle.licensePlate,
      };
      return result;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { mandantAccess: true, partner: true },
    });
    if (!user || !user.active) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      customerId: user.customerId,
      partnerId: user.partner?.id ?? null,
      mandantIds: user.mandantAccess.map((a) => a.mandantId),
      mustChangePassword: user.mustChangePassword,
    } as AuthUser;
  }
}
