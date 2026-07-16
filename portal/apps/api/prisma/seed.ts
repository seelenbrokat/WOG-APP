import { PrismaClient, UserRole, NotificationEvent, ShipmentStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'wog' },
    update: { name: 'WOG Logistics', active: true },
    create: { name: 'WOG Logistics', slug: 'wog', active: true },
  });

  const ag = await prisma.mandant.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'AG' } },
    update: { name: 'WOG AG', legalName: 'WOG AG', active: true },
    create: {
      organizationId: org.id,
      code: 'AG',
      name: 'WOG AG',
      legalName: 'WOG AG',
      active: true,
    },
  });

  const gmbh = await prisma.mandant.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'GMBH' } },
    update: { name: 'WOG GmbH', legalName: 'WOG GmbH', active: true },
    create: {
      organizationId: org.id,
      code: 'GMBH',
      name: 'WOG GmbH',
      legalName: 'WOG GmbH',
      active: true,
    },
  });

  const customer = await prisma.customer.upsert({
    where: {
      organizationId_customerNumber: { organizationId: org.id, customerNumber: 'K-10001' },
    },
    update: { name: 'Musterkunde Logistik GmbH', email: 'kunde@example.com' },
    create: {
      organizationId: org.id,
      customerNumber: 'K-10001',
      name: 'Musterkunde Logistik GmbH',
      email: 'kunde@example.com',
      phone: '+43 1 234567',
      vatId: 'ATU12345678',
      addresses: {
        create: {
          label: 'Hauptsitz',
          company: 'Musterkunde Logistik GmbH',
          street: 'Industriestraße 12',
          zip: '4020',
          city: 'Linz',
          country: 'AT',
          isDefault: true,
        },
      },
      contacts: {
        create: {
          name: 'Max Mustermann',
          email: 'kunde@example.com',
          phone: '+43 1 234567',
          role: 'Logistik',
        },
      },
    },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@wog.logistikberater.at';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: UserRole.ORG_ADMIN,
      emailVerifiedAt: new Date(),
      active: true,
    },
    create: {
      organizationId: org.id,
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      firstName: 'WOG',
      lastName: 'Admin',
      role: UserRole.ORG_ADMIN,
      emailVerifiedAt: new Date(),
      notificationPrefs: {
        create: Object.values(NotificationEvent).map((event) => ({ event, email: true })),
      },
    },
  });

  const dispatcherAg = await prisma.user.upsert({
    where: { email: 'dispatch.ag@wog.logistikberater.at' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'dispatch.ag@wog.logistikberater.at',
      passwordHash: await bcrypt.hash('DispatchAg123!', 10),
      firstName: 'Anna',
      lastName: 'AG-Dispo',
      role: UserRole.MANDANT_DISPATCHER,
      emailVerifiedAt: new Date(),
      mandantAccess: { create: [{ mandantId: ag.id }] },
      notificationPrefs: {
        create: Object.values(NotificationEvent).map((event) => ({ event, email: true })),
      },
    },
  });

  const dispatcherGmbh = await prisma.user.upsert({
    where: { email: 'dispatch.gmbh@wog.logistikberater.at' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'dispatch.gmbh@wog.logistikberater.at',
      passwordHash: await bcrypt.hash('DispatchGmbh123!', 10),
      firstName: 'Georg',
      lastName: 'GmbH-Dispo',
      role: UserRole.MANDANT_DISPATCHER,
      emailVerifiedAt: new Date(),
      mandantAccess: { create: [{ mandantId: gmbh.id }] },
      notificationPrefs: {
        create: Object.values(NotificationEvent).map((event) => ({ event, email: true })),
      },
    },
  });

  const lager = await prisma.user.upsert({
    where: { email: 'lager@wog.logistikberater.at' },
    update: {
      role: UserRole.WAREHOUSE_STAFF,
      passwordHash: await bcrypt.hash('Lager123!', 10),
      emailVerifiedAt: new Date(),
      active: true,
    },
    create: {
      organizationId: org.id,
      email: 'lager@wog.logistikberater.at',
      passwordHash: await bcrypt.hash('Lager123!', 10),
      firstName: 'Lara',
      lastName: 'Lager',
      role: UserRole.WAREHOUSE_STAFF,
      emailVerifiedAt: new Date(),
      mandantAccess: { create: [{ mandantId: ag.id }, { mandantId: gmbh.id }] },
      notificationPrefs: {
        create: Object.values(NotificationEvent).map((event) => ({ event, email: true })),
      },
    },
  });

  await prisma.user.upsert({
    where: { email: 'kunde@example.com' },
    update: { customerId: customer.id },
    create: {
      organizationId: org.id,
      customerId: customer.id,
      email: 'kunde@example.com',
      passwordHash: await bcrypt.hash('Kunde123!', 10),
      firstName: 'Max',
      lastName: 'Mustermann',
      role: UserRole.CUSTOMER_USER,
      emailVerifiedAt: new Date(),
      notificationPrefs: {
        create: Object.values(NotificationEvent).map((event) => ({ event, email: true })),
      },
    },
  });

  await prisma.partner.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'PARTNER1' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Partner Spedition Demo',
      code: 'PARTNER1',
      sftpUsername: 'partner1',
    },
  });

  const today = new Date();
  const pickupDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

  const existingShipment = await prisma.shipment.findFirst({
    where: { trackingNumber: 'WOGDEMO0001' },
  });
  if (!existingShipment) {
    await prisma.shipment.create({
      data: {
        organizationId: org.id,
        mandantId: ag.id,
        customerId: customer.id,
        trackingNumber: 'WOGDEMO0001',
        trackingPin: '1234',
        reference: 'DEMO-AG-001',
        status: ShipmentStatus.IN_TRANSIT,
        transportMode: 'LKW',
        goodsDescription: 'Paletten Ware',
        packageCount: 2,
        weightKg: 480,
        pickupCompany: 'Musterkunde Logistik GmbH',
        pickupStreet: 'Industriestraße 12',
        pickupZip: '4020',
        pickupCity: 'Linz',
        pickupCountry: 'AT',
        pickupDate,
        deliveryCompany: 'Empfänger AG',
        deliveryStreet: 'Handelsweg 5',
        deliveryZip: '1010',
        deliveryCity: 'Wien',
        deliveryCountry: 'AT',
        createdById: admin.id,
        positions: {
          create: [
            { description: 'Euro-Palette', quantity: 2, weightKg: 240, sscc: '123456789012345678' },
          ],
        },
        events: {
          create: [
            { status: ShipmentStatus.SUBMITTED, message: 'Auftrag erfasst', createdBy: 'seed' },
            { status: ShipmentStatus.ACCEPTED, message: 'Angenommen durch WOG AG', createdBy: 'seed' },
            {
              status: ShipmentStatus.IN_TRANSIT,
              message: 'Unterwegs nach Wien',
              location: 'A1',
              createdBy: 'seed',
            },
          ],
        },
      },
    });
  } else if (!existingShipment.pickupDate) {
    await prisma.shipment.update({
      where: { id: existingShipment.id },
      data: { pickupDate },
    });
  }

  console.log('Seed OK');
  console.log({
    org: org.slug,
    mandanten: [ag.code, gmbh.code],
    admin: adminEmail,
    dispatcherAg: dispatcherAg.email,
    dispatcherGmbh: dispatcherGmbh.email,
    lager: lager.email,
    customer: 'kunde@example.com',
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
