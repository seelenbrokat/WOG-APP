import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { createWriteStream, createReadStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CustomsService {
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {
    this.uploadDir = join(
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads'),
      'customs',
    );
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
  }

  list(user: AuthUser) {
    const where =
      user.role === UserRole.CUSTOMER_USER
        ? { organizationId: user.organizationId, customerId: user.customerId || '__none__' }
        : { organizationId: user.organizationId };

    return this.prisma.customsOrder.findMany({
      where,
      include: {
        customer: { select: { name: true, customerNumber: true } },
        mandant: { select: { name: true, code: true } },
        documents: {
          where: { type: DocumentType.CUSTOMS_PAPER },
          orderBy: { createdAt: 'desc' },
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const order = await this.prisma.customsOrder.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        customer: true,
        mandant: true,
        documents: {
          where: { type: DocumentType.CUSTOMS_PAPER },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!order) throw new NotFoundException();
    if (user.role === UserRole.CUSTOMER_USER && order.customerId !== user.customerId) {
      throw new ForbiddenException();
    }
    return order;
  }

  async create(
    user: AuthUser,
    data: {
      kennzeichen: string;
      grenzuebergang: string;
      zeit: string;
      importeur: string;
      mandantId?: string;
      customerId?: string;
      notes?: string;
    },
    files: Express.Multer.File[] = [],
  ) {
    let customerId = data.customerId;
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      customerId = user.customerId;
    }
    if (!customerId) throw new ForbiddenException('customerId erforderlich');

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.organizationId },
    });
    if (!customer) throw new NotFoundException('Kunde nicht gefunden');

    if (data.mandantId) {
      const mandant = await this.prisma.mandant.findFirst({
        where: { id: data.mandantId, organizationId: user.organizationId },
      });
      if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    }

    const order = await this.prisma.customsOrder.create({
      data: {
        organizationId: user.organizationId,
        customerId,
        mandantId: data.mandantId,
        kennzeichen: data.kennzeichen.trim().toUpperCase(),
        grenzuebergang: data.grenzuebergang.trim(),
        zeit: new Date(data.zeit),
        importeur: data.importeur.trim(),
        notes: data.notes,
        status: 'SUBMITTED',
        createdById: user.id,
      },
    });

    if (files?.length) {
      await this.savePapers(user, order.id, files);
    }

    const full = await this.get(user, order.id);

    await this.audit.log(user.id, 'customs.create', 'CustomsOrder', order.id, {
      kennzeichen: order.kennzeichen,
      grenzuebergang: order.grenzuebergang,
      documents: files?.length || 0,
    });

    const adminEmail = this.config.get('SEED_ADMIN_EMAIL') || 'admin@wog.logistikberater.at';
    const when = order.zeit.toLocaleString('de-AT');
    await this.notifications.sendRaw(
      adminEmail,
      `Verzollungsauftrag ${order.kennzeichen}`,
      [
        'Neuer Verzollungsauftrag:',
        `Kunde: ${full.customer.name}`,
        `Kennzeichen: ${order.kennzeichen}`,
        `Grenzübergang: ${order.grenzuebergang}`,
        `Zeit: ${when}`,
        `Importeur: ${order.importeur}`,
        full.mandant ? `Mandant: ${full.mandant.name}` : '',
        `Zollpapiere: ${full.documents.length} Datei(en)`,
        ...full.documents.map((d) => `- ${d.fileName}`),
        order.notes ? `Hinweis: ${order.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    return full;
  }

  async updateStatus(user: AuthUser, id: string, status: string) {
    if (user.role === UserRole.CUSTOMER_USER) throw new ForbiddenException();
    await this.get(user, id);
    return this.prisma.customsOrder.update({
      where: { id },
      data: { status },
      include: {
        customer: true,
        mandant: true,
        documents: { where: { type: DocumentType.CUSTOMS_PAPER } },
      },
    });
  }

  async uploadPapers(user: AuthUser, customsOrderId: string, files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('Keine Dateien übermittelt');
    await this.get(user, customsOrderId);
    const docs = await this.savePapers(user, customsOrderId, files);
    await this.audit.log(user.id, 'customs.papers.upload', 'CustomsOrder', customsOrderId, {
      count: docs.length,
      files: docs.map((d) => d.fileName),
    });
    return docs;
  }

  async openDocument(user: AuthUser, documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.organizationId !== user.organizationId || !doc.customsOrderId) {
      throw new NotFoundException();
    }
    await this.get(user, doc.customsOrderId);
    return { doc, stream: createReadStream(doc.storagePath) };
  }

  private async savePapers(user: AuthUser, customsOrderId: string, files: Express.Multer.File[]) {
    const order = await this.prisma.customsOrder.findUnique({ where: { id: customsOrderId } });
    if (!order) throw new NotFoundException();

    const saved = [];
    for (const file of files) {
      const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const storagePath = join(this.uploadDir, safeName);
      await pipeline(Readable.from(file.buffer), createWriteStream(storagePath));
      const doc = await this.prisma.document.create({
        data: {
          organizationId: order.organizationId,
          customerId: order.customerId,
          customsOrderId,
          type: DocumentType.CUSTOMS_PAPER,
          fileName: file.originalname,
          mimeType: file.mimetype || 'application/octet-stream',
          storagePath,
          sizeBytes: file.size,
          uploadedById: user.id,
        },
      });
      saved.push(doc);
    }
    return saved;
  }
}
