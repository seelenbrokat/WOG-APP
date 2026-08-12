import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PartnersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  list(user: AuthUser) {
    return this.prisma.partner.findMany({
      where: { organizationId: user.organizationId },
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: { name: 'asc' },
    });
  }

  async create(user: AuthUser, data: { name: string; code: string; sftpUsername?: string }) {
    const apiKey = `wog_${randomBytes(24).toString('hex')}`;
    const partner = await this.prisma.partner.create({
      data: {
        organizationId: user.organizationId,
        name: data.name,
        code: data.code.toUpperCase(),
        sftpUsername: data.sftpUsername,
        apiKeyPrefix: apiKey.slice(0, 12),
        apiKeyHash: await bcrypt.hash(apiKey, 10),
      },
    });
    await this.audit.log(user.id, 'partner.create', 'Partner', partner.id, { code: partner.code });
    return { ...partner, apiKey };
  }

  async listJobs(user: AuthUser, partnerId?: string) {
    return this.prisma.partnerJob.findMany({
      where: {
        partner: { organizationId: user.organizationId },
        ...(partnerId ? { partnerId } : {}),
      },
      include: { partner: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async validateApiKey(apiKey: string) {
    const prefix = apiKey.slice(0, 12);
    const partners = await this.prisma.partner.findMany({
      where: { apiKeyPrefix: prefix, active: true },
    });
    for (const p of partners) {
      if (p.apiKeyHash && (await bcrypt.compare(apiKey, p.apiKeyHash))) return p;
    }
    throw new UnauthorizedException('Ungültiger API-Key');
  }

  async partnerShipments(apiKey: string) {
    const partner = await this.validateApiKey(apiKey);
    // Partner sehen mandantengefilterte Daten über SFTP; REST liefert Job-Status
    return this.prisma.partnerJob.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async get(user: AuthUser, id: string) {
    const partner = await this.prisma.partner.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!partner) throw new NotFoundException();
    return partner;
  }
}
