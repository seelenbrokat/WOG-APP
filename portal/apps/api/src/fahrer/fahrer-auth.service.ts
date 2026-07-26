import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { VLB_PORTAL_TELEMATICS_CONFIG } from '../integrations/telematics-xml.builder';
import { PinLoginDto, QrLoginDto } from './dto/auth.dto';
import { DriverAuthUser } from './fahrer.types';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class FahrerAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private async resolveOrg(tenant?: string) {
    const slug = (tenant || 'wog').toLowerCase();
    const org = await this.prisma.organization.findFirst({
      where: { slug, active: true },
    });
    if (!org) throw new BadRequestException(`Tenant/Organisation nicht gefunden: ${slug}`);
    return org;
  }

  private async issueSession(opts: {
    organizationId: string;
    tenant: string;
    driver: {
      id: string;
      telematicsId: string;
      firstName?: string | null;
      lastName?: string | null;
    };
    vehicle: {
      id: string;
      soloplanVehicleId: string;
      licensePlate?: string | null;
    };
    deviceLabel?: string;
  }) {
    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await this.prisma.driverDevice.create({
      data: {
        organizationId: opts.organizationId,
        driverId: opts.driver.id,
        vehicleId: opts.vehicle.id,
        refreshTokenHash: hashToken(refreshToken),
        deviceLabel: opts.deviceLabel,
        expiresAt,
      },
    });

    const payload: DriverAuthUser = {
      typ: 'driver',
      id: opts.driver.id,
      organizationId: opts.organizationId,
      tenant: opts.tenant,
      driverId: opts.driver.id,
      driverTelematicsId: opts.driver.telematicsId,
      vehicleId: opts.vehicle.id,
      vehicleSoloplanId: opts.vehicle.soloplanVehicleId,
      firstName: opts.driver.firstName,
      lastName: opts.driver.lastName,
      licensePlate: opts.vehicle.licensePlate,
    };

    const accessToken = await this.jwt.signAsync(
      { ...payload, sub: opts.driver.id },
      { expiresIn: '12h' },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 12 * 60 * 60,
      telematicsConfig: VLB_PORTAL_TELEMATICS_CONFIG,
      driver: {
        id: opts.driver.id,
        telematicsId: opts.driver.telematicsId,
        firstName: opts.driver.firstName,
        lastName: opts.driver.lastName,
      },
      vehicle: {
        id: opts.vehicle.id,
        soloplanVehicleId: opts.vehicle.soloplanVehicleId,
        licensePlate: opts.vehicle.licensePlate,
      },
      tenant: opts.tenant,
    };
  }

  async listPublicVehicles(tenant?: string) {
    const org = await this.resolveOrg(tenant);
    return this.prisma.vehicle.findMany({
      where: {
        organizationId: org.id,
        active: true,
        soloplanVehicleId: { not: VLB_PORTAL_TELEMATICS_CONFIG },
      },
      select: {
        id: true,
        soloplanVehicleId: true,
        number: true,
        licensePlate: true,
        matchcode: true,
        lastDriverId: true,
      },
      orderBy: [{ number: 'asc' }, { licensePlate: 'asc' }],
    });
  }

  async loginWithPin(dto: PinLoginDto) {
    const org = await this.resolveOrg(dto.tenant);
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        organizationId: org.id,
        active: true,
        OR: [
          { id: dto.vehicleId },
          { soloplanVehicleId: dto.vehicleId },
          { number: dto.vehicleId },
          { licensePlate: dto.vehicleId },
        ],
      },
    });
    if (!vehicle) throw new UnauthorizedException('Fahrzeug nicht gefunden');
    if (!vehicle.pin || vehicle.pin !== dto.pin) {
      throw new UnauthorizedException('PIN ungültig');
    }

    let driver = dto.driverTelematicsId
      ? await this.prisma.driver.findFirst({
          where: {
            organizationId: org.id,
            telematicsId: dto.driverTelematicsId,
            active: true,
          },
        })
      : null;

    if (!driver && vehicle.lastDriverId) {
      driver = await this.prisma.driver.findFirst({
        where: {
          organizationId: org.id,
          telematicsId: vehicle.lastDriverId,
          active: true,
        },
      });
    }

    if (!driver) {
      driver = await this.prisma.driver.findFirst({
        where: { organizationId: org.id, active: true, lastVehicleId: vehicle.id },
      });
    }

    if (!driver) {
      throw new BadRequestException(
        'Kein Fahrer dem Fahrzeug zugeordnet – bitte driverTelematicsId angeben',
      );
    }

    await this.prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { lastDriverId: driver.telematicsId },
    });
    await this.prisma.driver.update({
      where: { id: driver.id },
      data: { lastVehicleId: vehicle.id },
    });

    return this.issueSession({
      organizationId: org.id,
      tenant: org.slug,
      driver,
      vehicle,
      deviceLabel: dto.deviceLabel,
    });
  }

  async loginWithQr(dto: QrLoginDto) {
    const tokenHash = hashToken(dto.token);
    const qr = await this.prisma.driverQrToken.findUnique({
      where: { tokenHash },
      include: { vehicle: true, driver: true, organization: true },
    });
    if (!qr || qr.usedAt || qr.expiresAt < new Date()) {
      throw new UnauthorizedException('QR-Token ungültig oder abgelaufen');
    }
    if (!qr.vehicle.active) throw new UnauthorizedException('Fahrzeug inaktiv');

    let driver = qr.driver;
    if (!driver && qr.vehicle.lastDriverId) {
      driver = await this.prisma.driver.findFirst({
        where: {
          organizationId: qr.organizationId,
          telematicsId: qr.vehicle.lastDriverId,
          active: true,
        },
      });
    }
    if (!driver) {
      throw new BadRequestException('QR ohne zugeordneten Fahrer');
    }

    await this.prisma.driverQrToken.update({
      where: { id: qr.id },
      data: { usedAt: new Date() },
    });

    return this.issueSession({
      organizationId: qr.organizationId,
      tenant: qr.organization.slug,
      driver,
      vehicle: qr.vehicle,
      deviceLabel: dto.deviceLabel,
    });
  }

  async refresh(refreshToken: string) {
    const device = await this.prisma.driverDevice.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      include: { driver: true, vehicle: true, organization: true },
    });
    if (!device || device.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh-Token ungültig');
    }
    if (!device.driver.active || !device.vehicle.active) {
      throw new UnauthorizedException('Fahrer oder Fahrzeug inaktiv');
    }

    await this.prisma.driverDevice.update({
      where: { id: device.id },
      data: { lastUsedAt: new Date() },
    });

    // Altes Refresh invalidieren und neues ausstellen
    await this.prisma.driverDevice.delete({ where: { id: device.id } });
    return this.issueSession({
      organizationId: device.organizationId,
      tenant: device.organization.slug,
      driver: device.driver,
      vehicle: device.vehicle,
      deviceLabel: device.deviceLabel || undefined,
    });
  }

  /** Dispo: QR-Token erzeugen */
  async createQrToken(
    organizationId: string,
    opts: { vehicleId: string; driverId?: string; createdByUserId?: string; ttlHours?: number },
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: opts.vehicleId, organizationId, active: true },
    });
    if (!vehicle) throw new BadRequestException('Fahrzeug nicht gefunden');

    const raw = randomBytes(24).toString('hex');
    const ttlHours = opts.ttlHours ?? 72;
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
    await this.prisma.driverQrToken.create({
      data: {
        organizationId,
        vehicleId: vehicle.id,
        driverId: opts.driverId,
        tokenHash: hashToken(raw),
        expiresAt,
        createdByUserId: opts.createdByUserId,
      },
    });

    return {
      token: raw,
      expiresAt: expiresAt.toISOString(),
      vehicle: {
        id: vehicle.id,
        soloplanVehicleId: vehicle.soloplanVehicleId,
        licensePlate: vehicle.licensePlate,
      },
      payload: `vlb-zustell://login?token=${raw}`,
    };
  }
}
