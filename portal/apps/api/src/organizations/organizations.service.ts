import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_EZOLL_FILENAME_IGNORE_PREFIXES,
  EZOLL_FILENAME_IGNORE_PREFIXES_KEY,
  normalizeFilenameIgnorePrefixes,
} from '@wog/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  findMine(user: AuthUser) {
    return this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      include: { mandanten: { orderBy: { name: 'asc' } } },
    });
  }

  async update(user: AuthUser, data: { name?: string; active?: boolean }) {
    const org = await this.prisma.organization.update({
      where: { id: user.organizationId },
      data,
    });
    await this.audit.log(user.id, 'organization.update', 'Organization', org.id, data);
    return org;
  }

  async getOrThrow(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organisation nicht gefunden');
    return org;
  }

  async getSettingValue(organizationId: string, key: string): Promise<unknown | null> {
    const row = await this.prisma.organizationSetting.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
    return row?.value ?? null;
  }

  async upsertSetting(organizationId: string, key: string, value: unknown) {
    return this.prisma.organizationSetting.upsert({
      where: { organizationId_key: { organizationId, key } },
      create: { organizationId, key, value: value as object },
      update: { value: value as object },
    });
  }

  async getEzollFilenameIgnorePrefixes(organizationId: string): Promise<string[]> {
    const stored = await this.getSettingValue(organizationId, EZOLL_FILENAME_IGNORE_PREFIXES_KEY);
    return normalizeFilenameIgnorePrefixes(
      stored,
      DEFAULT_EZOLL_FILENAME_IGNORE_PREFIXES,
    );
  }

  async getEzollInboundConfig(user: AuthUser) {
    const prefixes = await this.getEzollFilenameIgnorePrefixes(user.organizationId);
    return {
      key: EZOLL_FILENAME_IGNORE_PREFIXES_KEY,
      filenameIgnorePrefixes: prefixes,
      defaults: [...DEFAULT_EZOLL_FILENAME_IGNORE_PREFIXES],
    };
  }

  async updateEzollInboundConfig(user: AuthUser, prefixesInput: unknown) {
    const prefixes = normalizeFilenameIgnorePrefixes(
      prefixesInput,
      DEFAULT_EZOLL_FILENAME_IGNORE_PREFIXES,
    );
    await this.upsertSetting(
      user.organizationId,
      EZOLL_FILENAME_IGNORE_PREFIXES_KEY,
      prefixes,
    );
    await this.audit.log(
      user.id,
      'organization.setting.update',
      'OrganizationSetting',
      user.organizationId,
      { key: EZOLL_FILENAME_IGNORE_PREFIXES_KEY, prefixes },
    );
    return this.getEzollInboundConfig(user);
  }
}
