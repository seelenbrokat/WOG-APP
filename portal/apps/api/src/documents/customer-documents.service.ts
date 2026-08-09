import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomerDocCategory, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import {
  allCustomerDocCategories,
  CUSTOMER_DOC_CATEGORY_LABELS,
} from './customer-doc-categories';

@Injectable()
export class CustomerDocumentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  listAvailableCategories() {
    return allCustomerDocCategories().map((code) => ({
      code,
      label: CUSTOMER_DOC_CATEGORY_LABELS[code],
    }));
  }

  async getModuleConfig(user: AuthUser, customerId: string) {
    const customer = await this.requireCustomer(user, customerId);
    const access = await this.prisma.customerDocumentCategoryAccess.findMany({
      where: { customerId: customer.id },
      orderBy: { category: 'asc' },
    });
    return {
      customerId: customer.id,
      customerName: customer.name,
      documentsModuleEnabled: customer.documentsModuleEnabled,
      categories: allCustomerDocCategories().map((code) => {
        const row = access.find((a) => a.category === code);
        return {
          code,
          label: CUSTOMER_DOC_CATEGORY_LABELS[code],
          enabled: Boolean(row?.active),
          required: row?.required ?? true,
        };
      }),
    };
  }

  async setModuleConfig(
    user: AuthUser,
    customerId: string,
    data: {
      documentsModuleEnabled: boolean;
      categories?: Array<{
        code: CustomerDocCategory;
        enabled: boolean;
        required?: boolean;
      }>;
    },
  ) {
    if (user.role !== UserRole.ORG_ADMIN && user.role !== UserRole.MANDANT_DISPATCHER) {
      throw new ForbiddenException();
    }
    const customer = await this.requireCustomer(user, customerId);
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { documentsModuleEnabled: Boolean(data.documentsModuleEnabled) },
    });

    if (data.categories) {
      for (const cat of data.categories) {
        if (!allCustomerDocCategories().includes(cat.code)) {
          throw new BadRequestException(`Unbekannte Kategorie ${cat.code}`);
        }
        if (cat.enabled) {
          await this.prisma.customerDocumentCategoryAccess.upsert({
            where: {
              customerId_category: { customerId: customer.id, category: cat.code },
            },
            create: {
              customerId: customer.id,
              category: cat.code,
              active: true,
              required: cat.required ?? true,
            },
            update: {
              active: true,
              required: cat.required ?? true,
            },
          });
        } else {
          await this.prisma.customerDocumentCategoryAccess.updateMany({
            where: { customerId: customer.id, category: cat.code },
            data: { active: false },
          });
        }
      }
    }

    await this.audit.log(user.id, 'customer.documentsModule', 'Customer', customer.id, {
      documentsModuleEnabled: data.documentsModuleEnabled,
      categories: data.categories,
    });
    return this.getModuleConfig(user, customer.id);
  }

  /** Für CUSTOMER_USER: eigene Modul-Config (nur freigeschaltete Kategorien) */
  async myModuleConfig(user: AuthUser) {
    if (user.role !== UserRole.CUSTOMER_USER || !user.customerId) {
      throw new ForbiddenException('Nur für Kundenbenutzer');
    }
    const full = await this.getModuleConfig(user, user.customerId);
    return {
      ...full,
      categories: full.categories.filter((c) => c.enabled),
    };
  }

  async assertModuleEnabled(user: AuthUser) {
    if (user.role !== UserRole.CUSTOMER_USER) return null;
    if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto');
    const customer = await this.prisma.customer.findFirst({
      where: { id: user.customerId, organizationId: user.organizationId },
      select: {
        id: true,
        documentsModuleEnabled: true,
        documentCategoryAccess: { where: { active: true } },
      },
    });
    if (!customer?.documentsModuleEnabled) {
      throw new ForbiddenException('Dokumente-Modul ist für Ihr Konto nicht freigeschaltet');
    }
    return customer;
  }

  async listForShipmentWithDownloads(user: AuthUser, shipmentId: string) {
    const customer = await this.assertModuleEnabled(user);
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        organizationId: user.organizationId,
        ...(user.role === UserRole.CUSTOMER_USER && user.customerId
          ? { customerId: user.customerId }
          : {}),
      },
      select: { id: true, customerId: true },
    });
    if (!shipment) throw new NotFoundException('Sendung nicht gefunden');

    const allowed =
      user.role === UserRole.CUSTOMER_USER
        ? new Set((customer?.documentCategoryAccess || []).map((a) => a.category))
        : null;

    const docs = await this.prisma.document.findMany({
      where: {
        shipmentId,
        organizationId: user.organizationId,
        categoryCode: { not: null },
        ...(user.role === UserRole.CUSTOMER_USER && user.customerId
          ? { customerId: user.customerId }
          : {}),
      },
      include: {
        downloads: user.customerId
          ? { where: { userId: user.id }, take: 1 }
          : { take: 1, orderBy: { downloadedAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return docs
      .filter((d) => !allowed || (d.categoryCode && allowed.has(d.categoryCode)))
      .map((d) => ({
        id: d.id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        categoryCode: d.categoryCode,
        categoryLabel: d.categoryCode
          ? CUSTOMER_DOC_CATEGORY_LABELS[d.categoryCode]
          : null,
        createdAt: d.createdAt,
        downloaded: d.downloads.length > 0,
        downloadedAt: d.downloads[0]?.downloadedAt || null,
      }));
  }

  async markDownloaded(user: AuthUser, documentId: string) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        organizationId: user.organizationId,
        ...(user.role === UserRole.CUSTOMER_USER && user.customerId
          ? { customerId: user.customerId }
          : {}),
      },
    });
    if (!doc) throw new NotFoundException('Dokument nicht gefunden');
    if (user.role === UserRole.CUSTOMER_USER) {
      await this.assertModuleEnabled(user);
    }
    const customerId = doc.customerId || user.customerId;
    if (!customerId) return { ok: true, downloaded: false };

    await this.prisma.documentDownload.upsert({
      where: {
        documentId_userId: { documentId: doc.id, userId: user.id },
      },
      create: {
        documentId: doc.id,
        userId: user.id,
        customerId,
      },
      update: {
        downloadedAt: new Date(),
      },
    });
    await this.audit.log(user.id, 'document.download', 'Document', doc.id, {
      fileName: doc.fileName,
      categoryCode: doc.categoryCode,
    });
    return { ok: true, downloaded: true };
  }

  private async requireCustomer(user: AuthUser, customerId: string) {
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId || user.customerId !== customerId) {
        throw new ForbiddenException();
      }
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.organizationId },
    });
    if (!customer) throw new NotFoundException('Kunde nicht gefunden');
    return customer;
  }
}
