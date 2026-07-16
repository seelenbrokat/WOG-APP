import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { isVorarlbergChGoodsBorder, isFrankatur } from '@wog/shared';
import { createWriteStream, createReadStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export type PartyAddress = {
  firma: string;
  street: string;
  zip: string;
  city: string;
  country?: string;
};

export type CreateCustomsInput = {
  kennzeichen: string;
  grenzuebergang: string;
  zeit: string;
  importeur: string;
  frankatur: string;
  mandantId?: string;
  notes?: string;
  abweichenderFrachtzahler?: boolean | string;
  frachtzahlerFirma?: string;
  frachtzahlerStreet?: string;
  frachtzahlerZip?: string;
  frachtzahlerCity?: string;
  frachtzahlerCountry?: string;
  absenderFirma: string;
  absenderStreet: string;
  absenderZip: string;
  absenderCity: string;
  absenderCountry?: string;
  empfaengerFirma: string;
  empfaengerStreet: string;
  empfaengerZip: string;
  empfaengerCity: string;
  empfaengerCountry?: string;
};

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

  async create(user: AuthUser, data: CreateCustomsInput, files: Express.Multer.File[] = []) {
    if (!user.customerId) {
      throw new ForbiddenException(
        'Verzollungsaufträge nur mit Kundenkonto – bitte als Kunde anmelden',
      );
    }
    const customerId = user.customerId;

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

    const grenzuebergang = data.grenzuebergang.trim();
    if (!isVorarlbergChGoodsBorder(grenzuebergang)) {
      throw new BadRequestException(
        'Grenzübergang ist für den Warenverkehr Vorarlberg–Schweiz nicht freigegeben',
      );
    }

    const frankatur = data.frankatur.trim();
    if (!isFrankatur(frankatur)) {
      throw new BadRequestException('Ungültige Frankatur');
    }

    this.assertParty('Absender', {
      firma: data.absenderFirma,
      street: data.absenderStreet,
      zip: data.absenderZip,
      city: data.absenderCity,
    });
    this.assertParty('Empfänger', {
      firma: data.empfaengerFirma,
      street: data.empfaengerStreet,
      zip: data.empfaengerZip,
      city: data.empfaengerCity,
    });

    const abweichend =
      data.abweichenderFrachtzahler === true ||
      data.abweichenderFrachtzahler === 'true' ||
      data.abweichenderFrachtzahler === '1';

    if (abweichend) {
      this.assertParty('Frachtzahler', {
        firma: data.frachtzahlerFirma || '',
        street: data.frachtzahlerStreet || '',
        zip: data.frachtzahlerZip || '',
        city: data.frachtzahlerCity || '',
      });
    }

    const order = await this.prisma.customsOrder.create({
      data: {
        organizationId: user.organizationId,
        customerId,
        mandantId: data.mandantId,
        kennzeichen: data.kennzeichen.trim().toUpperCase(),
        grenzuebergang,
        zeit: new Date(data.zeit),
        importeur: data.importeur.trim(),
        frankatur,
        abweichenderFrachtzahler: abweichend,
        frachtzahlerFirma: abweichend ? data.frachtzahlerFirma?.trim() : null,
        frachtzahlerStreet: abweichend ? data.frachtzahlerStreet?.trim() : null,
        frachtzahlerZip: abweichend ? data.frachtzahlerZip?.trim() : null,
        frachtzahlerCity: abweichend ? data.frachtzahlerCity?.trim() : null,
        frachtzahlerCountry: abweichend ? data.frachtzahlerCountry?.trim() || 'AT' : null,
        absenderFirma: data.absenderFirma.trim(),
        absenderStreet: data.absenderStreet.trim(),
        absenderZip: data.absenderZip.trim(),
        absenderCity: data.absenderCity.trim(),
        absenderCountry: data.absenderCountry?.trim() || 'AT',
        empfaengerFirma: data.empfaengerFirma.trim(),
        empfaengerStreet: data.empfaengerStreet.trim(),
        empfaengerZip: data.empfaengerZip.trim(),
        empfaengerCity: data.empfaengerCity.trim(),
        empfaengerCountry: data.empfaengerCountry?.trim() || 'CH',
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
      frankatur: order.frankatur,
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
        `Frankatur: ${order.frankatur}`,
        `Importeur: ${order.importeur}`,
        `Absender: ${order.absenderFirma}, ${order.absenderStreet}, ${order.absenderZip} ${order.absenderCity}`,
        `Empfänger: ${order.empfaengerFirma}, ${order.empfaengerStreet}, ${order.empfaengerZip} ${order.empfaengerCity}`,
        abweichend
          ? `Frachtzahler: ${order.frachtzahlerFirma}, ${order.frachtzahlerStreet}, ${order.frachtzahlerZip} ${order.frachtzahlerCity}`
          : `Frachtzahler: ${full.customer.name} (Auftraggeber)`,
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

  private assertParty(label: string, party: PartyAddress) {
    if (!party.firma?.trim() || !party.street?.trim() || !party.zip?.trim() || !party.city?.trim()) {
      throw new BadRequestException(`${label}: Firma, Straße, PLZ und Ort sind erforderlich`);
    }
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
