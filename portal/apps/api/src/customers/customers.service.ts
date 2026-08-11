import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { computeNextRun, parseWeekdays } from '../common/schedule';

export type AddressInput = {
  label?: string;
  company?: string;
  street: string;
  zip: string;
  city: string;
  country?: string;
  usage?: string;
  isDefault?: boolean;
};

export type TemplateInput = {
  name: string;
  mandantId?: string;
  reference?: string;
  transportMode?: string;
  goodsDescription?: string;
  packageCount?: number;
  weightKg?: number;
  volumeM3?: number;
  pickupAddressId?: string;
  deliveryAddressId?: string;
  pickupCompany?: string;
  pickupStreet?: string;
  pickupZip?: string;
  pickupCity?: string;
  pickupCountry?: string;
  deliveryCompany?: string;
  deliveryStreet?: string;
  deliveryZip?: string;
  deliveryCity?: string;
  deliveryCountry?: string;
  notes?: string;
  scheduleEnabled?: boolean;
  scheduleFreq?: string;
  scheduleWeekdays?: string;
};

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private resolveCustomerId(user: AuthUser, customerId?: string) {
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      if (customerId && customerId !== user.customerId) throw new ForbiddenException();
      return user.customerId;
    }
    if (!customerId) throw new ForbiddenException('customerId erforderlich');
    return customerId;
  }

  list(user: AuthUser) {
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      // Nur eigenes Konto – Adressbuch bleibt kundenisoliert
      return this.prisma.customer.findMany({
        where: { id: user.customerId, organizationId: user.organizationId },
        include: {
          addresses: { orderBy: [{ isDefault: 'desc' }, { label: 'asc' }] },
          contacts: true,
          templates: true,
        },
      });
    }
    // Staff: Kontakte ok; Adressbuch-Details nur über /addresses (kundenisoliert)
    return this.prisma.customer.findMany({
      where: { organizationId: user.organizationId },
      include: {
        contacts: true,
        documentCategoryAccess: { where: { active: true } },
        _count: { select: { addresses: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async get(user: AuthUser, id: string) {
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      if (user.customerId !== id) throw new NotFoundException();
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { label: 'asc' }] },
        contacts: true,
        templates: { orderBy: { name: 'asc' } },
        users: { select: { id: true, email: true, firstName: true, lastName: true, active: true } },
      },
    });
    if (!customer) throw new NotFoundException();
    return customer;
  }

  async create(
    user: AuthUser,
    data: {
      customerNumber: string;
      name: string;
      email?: string;
      phone?: string;
      vatId?: string;
    },
  ) {
    const customer = await this.prisma.customer.create({
      data: {
        organizationId: user.organizationId,
        customerNumber: data.customerNumber,
        name: data.name,
        email: data.email,
        phone: data.phone,
        vatId: data.vatId,
      },
    });
    await this.audit.log(user.id, 'customer.create', 'Customer', customer.id, data);
    return customer;
  }

  async update(
    user: AuthUser,
    id: string,
    data: Partial<{
      name: string;
      email: string;
      phone: string;
      vatId: string;
      active: boolean;
      documentsModuleEnabled: boolean;
    }>,
  ) {
    await this.get(user, id);
    const customer = await this.prisma.customer.update({ where: { id }, data });
    await this.audit.log(user.id, 'customer.update', 'Customer', id, data);
    return customer;
  }

  async listAddresses(user: AuthUser, customerId?: string) {
    const id = this.resolveCustomerId(user, customerId);
    await this.get(user, id);
    return this.prisma.address.findMany({
      where: { customerId: id },
      orderBy: [{ isDefault: 'desc' }, { label: 'asc' }, { company: 'asc' }],
    });
  }

  async addAddress(user: AuthUser, customerId: string | undefined, data: AddressInput) {
    const id = this.resolveCustomerId(user, customerId);
    await this.get(user, id);
    if (data.isDefault) {
      await this.prisma.address.updateMany({ where: { customerId: id }, data: { isDefault: false } });
    }
    const address = await this.prisma.address.create({
      data: {
        customerId: id,
        label: data.label,
        company: data.company,
        street: data.street,
        zip: data.zip,
        city: data.city,
        country: data.country || 'AT',
        usage: data.usage || 'BOTH',
        isDefault: data.isDefault || false,
      },
    });
    await this.audit.log(user.id, 'address.create', 'Address', address.id, { customerId: id });
    return address;
  }

  async updateAddress(user: AuthUser, addressId: string, data: Partial<AddressInput>) {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address?.customerId) throw new NotFoundException();
    await this.get(user, address.customerId);
    if (data.isDefault) {
      await this.prisma.address.updateMany({
        where: { customerId: address.customerId },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.update({
      where: { id: addressId },
      data: {
        label: data.label,
        company: data.company,
        street: data.street,
        zip: data.zip,
        city: data.city,
        country: data.country,
        usage: data.usage,
        isDefault: data.isDefault,
      },
    });
  }

  async deleteAddress(user: AuthUser, addressId: string) {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address?.customerId) throw new NotFoundException();
    await this.get(user, address.customerId);
    await this.prisma.address.delete({ where: { id: addressId } });
    return { ok: true };
  }

  async addContact(
    user: AuthUser,
    customerId: string,
    data: { name: string; email?: string; phone?: string; role?: string },
  ) {
    await this.get(user, customerId);
    return this.prisma.contact.create({ data: { customerId, ...data } });
  }

  async listTemplates(user: AuthUser, customerId?: string) {
    const id = this.resolveCustomerId(user, customerId);
    await this.get(user, id);
    return this.prisma.shipmentTemplate.findMany({
      where: { customerId: id },
      orderBy: { name: 'asc' },
    });
  }

  async createTemplate(user: AuthUser, customerId: string | undefined, data: TemplateInput) {
    const id = this.resolveCustomerId(user, customerId);
    await this.get(user, id);

    let pickup = {
      pickupCompany: data.pickupCompany,
      pickupStreet: data.pickupStreet,
      pickupZip: data.pickupZip,
      pickupCity: data.pickupCity,
      pickupCountry: data.pickupCountry || 'AT',
    };
    let delivery = {
      deliveryCompany: data.deliveryCompany,
      deliveryStreet: data.deliveryStreet,
      deliveryZip: data.deliveryZip,
      deliveryCity: data.deliveryCity,
      deliveryCountry: data.deliveryCountry || 'AT',
    };

    if (data.pickupAddressId) {
      const a = await this.prisma.address.findFirst({ where: { id: data.pickupAddressId, customerId: id } });
      if (a) {
        pickup = {
          pickupCompany: a.company || undefined,
          pickupStreet: a.street,
          pickupZip: a.zip,
          pickupCity: a.city,
          pickupCountry: a.country,
        };
      }
    }
    if (data.deliveryAddressId) {
      const a = await this.prisma.address.findFirst({ where: { id: data.deliveryAddressId, customerId: id } });
      if (a) {
        delivery = {
          deliveryCompany: a.company || undefined,
          deliveryStreet: a.street,
          deliveryZip: a.zip,
          deliveryCity: a.city,
          deliveryCountry: a.country,
        };
      }
    }

    const schedule = this.resolveScheduleFields(data, null);
    if (schedule.scheduleEnabled && !data.mandantId) {
      throw new BadRequestException('Für wiederkehrende Vorlagen ist ein Mandant erforderlich');
    }

    const template = await this.prisma.shipmentTemplate.create({
      data: {
        customerId: id,
        name: data.name,
        mandantId: data.mandantId,
        reference: data.reference,
        transportMode: data.transportMode,
        goodsDescription: data.goodsDescription,
        packageCount: data.packageCount ?? 1,
        weightKg: data.weightKg,
        volumeM3: data.volumeM3,
        pickupAddressId: data.pickupAddressId,
        deliveryAddressId: data.deliveryAddressId,
        notes: data.notes,
        ...pickup,
        ...delivery,
        ...schedule,
      },
    });
    await this.audit.log(user.id, 'template.create', 'ShipmentTemplate', template.id, {
      name: data.name,
      scheduleEnabled: template.scheduleEnabled,
    });
    return template;
  }

  async updateTemplate(user: AuthUser, templateId: string, data: Partial<TemplateInput>) {
    const template = await this.prisma.shipmentTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException();
    await this.get(user, template.customerId);
    const schedule = this.resolveScheduleFields(data, template);
    const mandantId = data.mandantId !== undefined ? data.mandantId : template.mandantId;
    if (schedule.scheduleEnabled && !mandantId) {
      throw new BadRequestException('Für wiederkehrende Vorlagen ist ein Mandant erforderlich');
    }
    const updated = await this.prisma.shipmentTemplate.update({
      where: { id: templateId },
      data: {
        name: data.name,
        mandantId: data.mandantId,
        reference: data.reference,
        transportMode: data.transportMode,
        goodsDescription: data.goodsDescription,
        packageCount: data.packageCount,
        weightKg: data.weightKg,
        volumeM3: data.volumeM3,
        pickupAddressId: data.pickupAddressId,
        deliveryAddressId: data.deliveryAddressId,
        pickupCompany: data.pickupCompany,
        pickupStreet: data.pickupStreet,
        pickupZip: data.pickupZip,
        pickupCity: data.pickupCity,
        pickupCountry: data.pickupCountry,
        deliveryCompany: data.deliveryCompany,
        deliveryStreet: data.deliveryStreet,
        deliveryZip: data.deliveryZip,
        deliveryCity: data.deliveryCity,
        deliveryCountry: data.deliveryCountry,
        notes: data.notes,
        ...schedule,
      },
    });
    await this.audit.log(user.id, 'template.update', 'ShipmentTemplate', updated.id, {
      name: updated.name,
      scheduleEnabled: updated.scheduleEnabled,
    });
    return updated;
  }

  async deleteTemplate(user: AuthUser, templateId: string) {
    const template = await this.prisma.shipmentTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException();
    await this.get(user, template.customerId);
    await this.prisma.shipmentTemplate.delete({ where: { id: templateId } });
    await this.audit.log(user.id, 'template.delete', 'ShipmentTemplate', templateId, {
      name: template.name,
    });
    return { ok: true };
  }

  private resolveScheduleFields(
    data: Partial<TemplateInput>,
    existing: {
      scheduleEnabled: boolean;
      scheduleFreq: string | null;
      scheduleWeekdays: string | null;
      scheduleNextRun: Date | null;
    } | null,
  ) {
    const enabled =
      data.scheduleEnabled !== undefined
        ? Boolean(data.scheduleEnabled)
        : existing?.scheduleEnabled ?? false;
    if (!enabled) {
      return {
        scheduleEnabled: false,
        scheduleFreq: null as string | null,
        scheduleWeekdays: null as string | null,
        scheduleNextRun: null as Date | null,
      };
    }
    const freq =
      data.scheduleFreq === 'WEEKLY' || data.scheduleFreq === 'DAILY'
        ? data.scheduleFreq
        : existing?.scheduleFreq === 'WEEKLY'
          ? 'WEEKLY'
          : 'DAILY';
    const weekdays =
      data.scheduleWeekdays !== undefined
        ? parseWeekdays(data.scheduleWeekdays).join(',')
        : existing?.scheduleWeekdays || parseWeekdays(null).join(',');
    const scheduleChanged =
      data.scheduleEnabled !== undefined ||
      data.scheduleFreq !== undefined ||
      data.scheduleWeekdays !== undefined ||
      !existing?.scheduleNextRun;
    return {
      scheduleEnabled: true,
      scheduleFreq: freq,
      scheduleWeekdays: weekdays,
      scheduleNextRun: scheduleChanged
        ? computeNextRun(new Date(), freq, weekdays)
        : existing!.scheduleNextRun,
    };
  }

  async saveAddressesFromShipment(
    user: AuthUser,
    customerId: string,
    pickup?: AddressInput & { save?: boolean },
    delivery?: AddressInput & { save?: boolean },
  ) {
    const saved = [];
    if (pickup?.save && pickup.street && pickup.zip && pickup.city) {
      saved.push(await this.addAddress(user, customerId, { ...pickup, usage: 'PICKUP', label: pickup.label || 'Abholung' }));
    }
    if (delivery?.save && delivery.street && delivery.zip && delivery.city) {
      saved.push(await this.addAddress(user, customerId, { ...delivery, usage: 'DELIVERY', label: delivery.label || 'Zustellung' }));
    }
    return saved;
  }

  /**
   * Einmalig/nachträglich: Abhol- und Zustelladressen aus bisherigen Sendungen ins Adressbuch.
   */
  async importAddressesFromShipments(user: AuthUser, customerId?: string) {
    const id = this.resolveCustomerId(user, customerId);
    await this.get(user, id);

    const shipments = await this.prisma.shipment.findMany({
      where: { customerId: id, organizationId: user.organizationId },
      select: {
        pickupCompany: true,
        pickupStreet: true,
        pickupZip: true,
        pickupCity: true,
        pickupCountry: true,
        deliveryCompany: true,
        deliveryStreet: true,
        deliveryZip: true,
        deliveryCity: true,
        deliveryCountry: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const s of shipments) {
      if (s.pickupStreet && s.pickupZip && s.pickupCity) {
        const r = await this.upsertAddress(id, {
          label: s.pickupCompany || 'Abholung',
          company: s.pickupCompany,
          street: s.pickupStreet,
          zip: s.pickupZip,
          city: s.pickupCity,
          country: s.pickupCountry || 'AT',
          usage: 'PICKUP',
        });
        if (r === 'created') created += 1;
        else if (r === 'updated') updated += 1;
        else skipped += 1;
      }
      if (s.deliveryStreet && s.deliveryZip && s.deliveryCity) {
        const r = await this.upsertAddress(id, {
          label: s.deliveryCompany || 'Zustellung',
          company: s.deliveryCompany,
          street: s.deliveryStreet,
          zip: s.deliveryZip,
          city: s.deliveryCity,
          country: s.deliveryCountry || 'AT',
          usage: 'DELIVERY',
        });
        if (r === 'created') created += 1;
        else if (r === 'updated') updated += 1;
        else skipped += 1;
      }
    }

    return { created, updated, skipped, shipments: shipments.length };
  }

  private async upsertAddress(
    customerId: string,
    data: {
      label?: string | null;
      company?: string | null;
      street: string;
      zip: string;
      city: string;
      country: string;
      usage: 'PICKUP' | 'DELIVERY' | 'BOTH';
    },
  ): Promise<'created' | 'updated' | 'skipped'> {
    const street = data.street.trim();
    const zip = data.zip.trim();
    const city = data.city.trim();
    const country = (data.country || 'AT').trim().toUpperCase() || 'AT';
    if (!street || !zip || !city) return 'skipped';

    const existing = await this.prisma.address.findFirst({
      where: {
        customerId,
        zip,
        country,
        street: { equals: street, mode: 'insensitive' },
        city: { equals: city, mode: 'insensitive' },
      },
    });

    if (existing) {
      const nextUsage =
        existing.usage === 'BOTH' || existing.usage === data.usage ? existing.usage : 'BOTH';
      const patch: { usage?: string; company?: string; label?: string } = {};
      if (nextUsage !== existing.usage) patch.usage = nextUsage;
      if (data.company && !existing.company) patch.company = data.company;
      if (data.label && !existing.label) patch.label = data.label;
      if (Object.keys(patch).length) {
        await this.prisma.address.update({ where: { id: existing.id }, data: patch });
        return 'updated';
      }
      return 'skipped';
    }

    await this.prisma.address.create({
      data: {
        customerId,
        label: data.label || data.company || undefined,
        company: data.company || undefined,
        street,
        zip,
        city,
        country,
        usage: data.usage,
      },
    });
    return 'created';
  }
}
