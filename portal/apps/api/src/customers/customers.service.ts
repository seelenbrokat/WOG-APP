import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  list(user: AuthUser) {
    if (user.role === UserRole.CUSTOMER_USER) {
      return this.prisma.customer.findMany({
        where: { id: user.customerId || '__none__', organizationId: user.organizationId },
        include: { addresses: true, contacts: true },
      });
    }
    return this.prisma.customer.findMany({
      where: { organizationId: user.organizationId },
      include: { addresses: true, contacts: true },
      orderBy: { name: 'asc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { addresses: true, contacts: true, users: { select: { id: true, email: true, firstName: true, lastName: true, active: true } } },
    });
    if (!customer) throw new NotFoundException();
    if (user.role === UserRole.CUSTOMER_USER && user.customerId !== id) {
      throw new NotFoundException();
    }
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
    data: Partial<{ name: string; email: string; phone: string; vatId: string; active: boolean }>,
  ) {
    await this.get(user, id);
    const customer = await this.prisma.customer.update({ where: { id }, data });
    await this.audit.log(user.id, 'customer.update', 'Customer', id, data);
    return customer;
  }

  async addAddress(
    user: AuthUser,
    customerId: string,
    data: {
      label?: string;
      company?: string;
      street: string;
      zip: string;
      city: string;
      country?: string;
      isDefault?: boolean;
    },
  ) {
    await this.get(user, customerId);
    return this.prisma.address.create({
      data: { customerId, ...data, country: data.country || 'AT' },
    });
  }

  async addContact(
    user: AuthUser,
    customerId: string,
    data: { name: string; email?: string; phone?: string; role?: string },
  ) {
    await this.get(user, customerId);
    return this.prisma.contact.create({ data: { customerId, ...data } });
  }
}
