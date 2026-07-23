import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { VLB_PORTAL_TELEMATICS_CONFIG } from '../integrations/telematics-xml.builder';

export type UpsertDriverInput = {
  telematicsId: string;
  firstName?: string | null;
  lastName?: string | null;
  pin?: string | null;
  mandantId?: string | null;
  lastVehicleId?: string | null;
  active?: boolean;
};

export type UpsertVehicleInput = {
  soloplanVehicleId: string;
  number?: string | null;
  matchcode?: string | null;
  licensePlate?: string | null;
  pin?: string | null;
  mandantId?: string | null;
  lastDriverId?: string | null;
  active?: boolean;
};

@Injectable()
export class DriverService {
  private readonly logger = new Logger(DriverService.name);

  constructor(private prisma: PrismaService) {}

  async listDrivers(user: AuthUser) {
    return this.prisma.driver.findMany({
      where: { organizationId: user.organizationId, active: true },
      include: {
        lastVehicle: {
          select: {
            id: true,
            soloplanVehicleId: true,
            number: true,
            licensePlate: true,
            matchcode: true,
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async listVehicles(user: AuthUser) {
    return this.prisma.vehicle.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: [{ number: 'asc' }, { licensePlate: 'asc' }],
    });
  }

  async upsertDriver(organizationId: string, data: UpsertDriverInput) {
    return this.prisma.driver.upsert({
      where: {
        organizationId_telematicsId: {
          organizationId,
          telematicsId: data.telematicsId,
        },
      },
      create: {
        organizationId,
        telematicsId: data.telematicsId,
        firstName: data.firstName || undefined,
        lastName: data.lastName || undefined,
        pin: data.pin || undefined,
        mandantId: data.mandantId || undefined,
        lastVehicleId: data.lastVehicleId || undefined,
        active: data.active ?? true,
      },
      update: {
        firstName: data.firstName ?? undefined,
        lastName: data.lastName ?? undefined,
        pin: data.pin ?? undefined,
        mandantId: data.mandantId ?? undefined,
        lastVehicleId: data.lastVehicleId ?? undefined,
        active: data.active ?? undefined,
      },
    });
  }

  async upsertVehicle(organizationId: string, data: UpsertVehicleInput) {
    return this.prisma.vehicle.upsert({
      where: {
        organizationId_soloplanVehicleId: {
          organizationId,
          soloplanVehicleId: data.soloplanVehicleId,
        },
      },
      create: {
        organizationId,
        soloplanVehicleId: data.soloplanVehicleId,
        number: data.number || undefined,
        matchcode: data.matchcode || undefined,
        licensePlate: data.licensePlate || undefined,
        pin: data.pin || undefined,
        mandantId: data.mandantId || undefined,
        lastDriverId: data.lastDriverId || undefined,
        active: data.active ?? true,
      },
      update: {
        number: data.number ?? undefined,
        matchcode: data.matchcode ?? undefined,
        licensePlate: data.licensePlate ?? undefined,
        pin: data.pin ?? undefined,
        mandantId: data.mandantId ?? undefined,
        lastDriverId: data.lastDriverId ?? undefined,
        active: data.active ?? undefined,
      },
    });
  }

  /**
   * Stammdaten aus den empfangenen InTouch-/Tour-Dateien anlegen:
   * - Fahrzeug 103 (SG432203/SG408255), PIN 1234 – behält seine Soloplan-ID
   * - Alias 10301 (Tour VehicleParam1)
   * - Fahrer Thomas Nerat (THNE)
   * Telematikkonfiguration der App: VLBPortal (kein Fahrzeug)
   */
  async bootstrapFromTelematicsSample(organizationId: string, mandantId?: string | null) {
    let resolvedMandantId = mandantId ?? null;
    if (!resolvedMandantId) {
      // Tour Client = 2 → Mandant-Code „2“
      const mandant = await this.prisma.mandant.findFirst({
        where: { organizationId, OR: [{ code: '2' }, { code: '02' }] },
        select: { id: true },
      });
      resolvedMandantId = mandant?.id ?? null;
    }

    const vehicle103 = await this.upsertVehicle(organizationId, {
      soloplanVehicleId: '103',
      number: '103',
      matchcode: 'SG432203',
      licensePlate: 'SG432203/SG408255',
      pin: '1234',
      mandantId: resolvedMandantId,
      lastDriverId: 'THNE',
    });
    // Alias laut Tour VehicleParam1
    await this.upsertVehicle(organizationId, {
      soloplanVehicleId: '10301',
      number: '103',
      matchcode: 'SG432203',
      licensePlate: 'SG432203/SG408255',
      pin: '1234',
      mandantId: resolvedMandantId,
      lastDriverId: 'THNE',
    });

    // Früher fälschlich als Fahrzeug angelegt – deaktivieren (VLBPortal = Config, keine VehicleId)
    await this.prisma.vehicle.updateMany({
      where: {
        organizationId,
        soloplanVehicleId: VLB_PORTAL_TELEMATICS_CONFIG,
      },
      data: { active: false },
    });

    const driver = await this.upsertDriver(organizationId, {
      telematicsId: 'THNE',
      firstName: 'Thomas',
      lastName: 'Nerat',
      mandantId: resolvedMandantId,
      lastVehicleId: vehicle103.id,
    });

    this.logger.log(
      `Bootstrap Fahrer-App: Fahrzeug ${vehicle103.soloplanVehicleId}, Fahrer ${driver.telematicsId}, Config ${VLB_PORTAL_TELEMATICS_CONFIG}`,
    );

    return {
      vehicle103,
      driver,
      telematicsConfig: VLB_PORTAL_TELEMATICS_CONFIG,
      mandantId: resolvedMandantId,
    };
  }

  async getDriverByTelematicsId(user: AuthUser, telematicsId: string) {
    const driver = await this.prisma.driver.findFirst({
      where: { organizationId: user.organizationId, telematicsId },
      include: { lastVehicle: true },
    });
    if (!driver) throw new NotFoundException('Fahrer nicht gefunden');
    return driver;
  }
}
