import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import {
  isValidGrenzuebergang,
  normalizeSmartBorderPlate,
  isValidSmartBorderPlate,
  normalizePhoneE164,
} from '@wog/shared';
import { createWriteStream, createReadStream, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SoloplanService } from '../integrations/soloplan.service';
import { allocateVlbExternalNumber } from '../shipments/order-number';
import {
  formatGrenzeDateTime,
  writeVerzollungsauftragPdf,
} from './verzollungsauftrag-pdf';

function parsePositiveInt(raw: number | string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function parsePositiveKg(raw: number | string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

export type PartyAddress = {
  firma: string;
  street: string;
  zip: string;
  city: string;
  country?: string;
};

export type CreateCustomsInput = {
  kennzeichen: string;
  zulassungsland: string;
  kennzeichenAnhaenger?: string;
  zulassungslandAnhaenger?: string;
  grenzuebergang: string;
  grenzzollstelle?: string;
  zeit: string;
  importeur: string;
  zazKonto?: string;
  warenort?: string;
  /** Collianzahl (Zahl oder FormData-String) */
  packageCount?: number | string;
  /** Bruttogewicht kg */
  weightKg?: number | string;
  /** Nettogewicht kg */
  netWeightKg?: number | string;
  /** Wareninhalt / Inhaltsbeschreibung */
  goodsDescription?: string;
  /** Legacy – nicht mehr im Formular, optional */
  frankatur?: string;
  mandantId?: string;
  customerId?: string;
  notes?: string;
  driverPhone?: string;
  smartborderNotifyEmail?: string;
  smartborderSendSms?: boolean | string;
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
  private readonly logger = new Logger(CustomsService.name);
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private config: ConfigService,
    @Inject(forwardRef(() => SoloplanService))
    private soloplan: SoloplanService,
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
          where: {
            type: { in: [DocumentType.CUSTOMS_PAPER, DocumentType.INVOICE] },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
            type: true,
          },
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
          where: {
            type: { in: [DocumentType.CUSTOMS_PAPER, DocumentType.INVOICE] },
          },
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
    data: CreateCustomsInput,
    files: { papers?: Express.Multer.File[]; invoice?: Express.Multer.File[] } = {},
  ) {
    const papers = files.papers || [];
    const invoices = files.invoice || [];
    const isStaff =
      user.role === UserRole.ORG_ADMIN || user.role === UserRole.MANDANT_DISPATCHER;
    const customerId = isStaff
      ? (data.customerId || '').trim()
      : user.customerId || '';

    if (!customerId) {
      throw new BadRequestException(
        isStaff
          ? 'Bitte einen Kunden für den Verzollungsauftrag wählen'
          : 'Verzollungsaufträge nur mit Kundenkonto – bitte als Kunde anmelden',
      );
    }

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
    if (!isValidGrenzuebergang(grenzuebergang)) {
      throw new BadRequestException('Grenzübergang / Grenzzollstelle bitte angeben (Auswahl oder Freitext)');
    }

    if (!invoices.length) {
      throw new BadRequestException('Rechnung ist Pflicht – bitte die Rechnung hochladen');
    }

    const zulassungsland = (data.zulassungsland || 'AT').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(zulassungsland)) {
      throw new BadRequestException('Zulassungsland muss ein ISO-Ländercode (2 Buchstaben) sein');
    }

    const kennzeichen = normalizeSmartBorderPlate(data.kennzeichen, zulassungsland);
    if (!isValidSmartBorderPlate(kennzeichen, zulassungsland)) {
      throw new BadRequestException(
        'Kennzeichen entspricht nicht den Smart-Border-Austria-Eingaberichtlinien (keine Leerzeichen; landesspezifisches Format)',
      );
    }

    let kennzeichenAnhaenger: string | null = null;
    let zulassungslandAnhaenger: string | null = null;
    const rawTrailer = (data.kennzeichenAnhaenger || '').trim();
    if (rawTrailer) {
      zulassungslandAnhaenger = (data.zulassungslandAnhaenger || zulassungsland).trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(zulassungslandAnhaenger)) {
        throw new BadRequestException(
          'Zulassungsland Anhänger muss ein ISO-Ländercode (2 Buchstaben) sein',
        );
      }
      kennzeichenAnhaenger = normalizeSmartBorderPlate(rawTrailer, zulassungslandAnhaenger);
      if (!isValidSmartBorderPlate(kennzeichenAnhaenger, zulassungslandAnhaenger)) {
        throw new BadRequestException(
          'Kennzeichen Anhänger entspricht nicht den Smart-Border-Austria-Eingaberichtlinien',
        );
      }
    }

    const frankatur = (data.frankatur || '').trim() || '-';

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

    const absenderCountry = (data.absenderCountry?.trim() || 'AT').toUpperCase();
    const empfaengerCountry = (data.empfaengerCountry?.trim() || 'CH').toUpperCase();
    const fromChFl = ['CH', 'LI', 'FL'].includes(absenderCountry);
    const toAt = empfaengerCountry === 'AT' || empfaengerCountry === 'A';
    const warenort = data.warenort?.trim() || '';
    if (fromChFl && toAt && !warenort) {
      throw new BadRequestException(
        'Warenort/Verzollungsort ist bei Verkehrsrichtung CH/FL → Österreich Pflicht',
      );
    }

    const packageCount = parsePositiveInt(data.packageCount);
    const weightKg = parsePositiveKg(data.weightKg);
    const netWeightKg = parsePositiveKg(data.netWeightKg);
    if (packageCount == null || packageCount < 1) {
      throw new BadRequestException('Collianzahl bitte angeben (mindestens 1)');
    }
    if (weightKg == null) {
      throw new BadRequestException('Bruttogewicht (kg) bitte angeben');
    }
    if (netWeightKg == null) {
      throw new BadRequestException('Nettogewicht (kg) bitte angeben');
    }
    if (netWeightKg > weightKg) {
      throw new BadRequestException('Nettogewicht darf nicht größer als Bruttogewicht sein');
    }

    const goodsDescription = (data.goodsDescription || '').trim();
    if (!goodsDescription) {
      throw new BadRequestException('Inhalt / Warenbeschreibung bitte angeben');
    }

    const sendSms =
      data.smartborderSendSms === true ||
      data.smartborderSendSms === 'true' ||
      data.smartborderSendSms === '1';
    const driverPhoneRaw = (data.driverPhone || '').trim();
    let driverPhone: string | null = null;
    if (driverPhoneRaw || sendSms) {
      driverPhone = normalizePhoneE164(driverPhoneRaw);
      if (!driverPhone) {
        throw new BadRequestException(
          'Fahrer-Telefonnummer bitte im internationalen Format angeben (z. B. +436769075070)',
        );
      }
    }
    const notifyEmail = (data.smartborderNotifyEmail || '').trim().toLowerCase() || null;
    if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
      throw new BadRequestException('SmartBorder-Benachrichtigungs-E-Mail ist ungültig');
    }

    const externalNumber = await allocateVlbExternalNumber(
      this.prisma,
      user.organizationId,
    );

    const order = await this.prisma.customsOrder.create({
      data: {
        organizationId: user.organizationId,
        customerId,
        mandantId: data.mandantId,
        externalNumber,
        kennzeichen,
        zulassungsland,
        kennzeichenAnhaenger,
        zulassungslandAnhaenger,
        grenzuebergang,
        // Grenzzollstelle = Grenzübergang (ein Feld)
        grenzzollstelle: grenzuebergang,
        zeit: new Date(data.zeit),
        importeur: data.importeur.trim(),
        zazKonto: data.zazKonto?.trim() || null,
        warenort: warenort || null,
        packageCount,
        weightKg,
        netWeightKg,
        goodsDescription,
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
        absenderCountry,
        empfaengerFirma: data.empfaengerFirma.trim(),
        empfaengerStreet: data.empfaengerStreet.trim(),
        empfaengerZip: data.empfaengerZip.trim(),
        empfaengerCity: data.empfaengerCity.trim(),
        empfaengerCountry,
        notes: data.notes,
        driverPhone,
        smartborderNotifyEmail: notifyEmail,
        smartborderSendSms: sendSms,
        status: 'SUBMITTED',
        createdById: user.id,
      },
    });

    if (invoices.length) {
      await this.savePapers(user, order.id, invoices, DocumentType.INVOICE);
    }
    if (papers.length) {
      await this.savePapers(user, order.id, papers, DocumentType.CUSTOMS_PAPER);
    }

    const full = await this.get(user, order.id);

    await this.audit.log(user.id, 'customs.create', 'CustomsOrder', order.id, {
      externalNumber: order.externalNumber,
      kennzeichen: order.kennzeichen,
      grenzuebergang: order.grenzuebergang,
      documents: invoices.length + papers.length,
      invoices: invoices.length,
    });

    const adminEmail = this.config.get('SEED_ADMIN_EMAIL') || 'admin@wog.logistikberater.at';
    const when = order.zeit.toLocaleString('de-AT');
    await this.notifications.sendRaw(
      adminEmail,
      `Verzollungsauftrag ${order.kennzeichen}`,
      [
        'Neuer Verzollungsauftrag:',
        `Auftrag: ${order.externalNumber}`,
        `Kunde: ${full.customer.name}`,
        `Kennzeichen: ${order.kennzeichen} (${order.zulassungsland})`,
        order.kennzeichenAnhaenger
          ? `Kennzeichen Anhänger: ${order.kennzeichenAnhaenger} (${order.zulassungslandAnhaenger || '–'})`
          : '',
        `Grenzübergang: ${order.grenzuebergang}`,
        `Zeit: ${when}`,
        `Importeur: ${order.importeur}`,
        order.zazKonto ? `ZAZ-Konto: ${order.zazKonto}` : '',
        order.warenort ? `Warenort/Verzollungsort: ${order.warenort}` : '',
        `Colli: ${order.packageCount ?? '–'}`,
        `Bruttogewicht: ${order.weightKg != null ? `${order.weightKg} kg` : '–'}`,
        `Nettogewicht: ${order.netWeightKg != null ? `${order.netWeightKg} kg` : '–'}`,
        `Inhalt: ${order.goodsDescription || '–'}`,
        driverPhone ? `Fahrertelefon: ${driverPhone}` : '',
        notifyEmail ? `E-Mail-Rückmeldung (SmartBorder): ${notifyEmail}` : '',
        sendSms ? 'SmartBorder-Link per SMS: ja' : '',
        `Absender: ${order.absenderFirma}, ${order.absenderStreet}, ${order.absenderZip} ${order.absenderCity}`,
        `Empfänger: ${order.empfaengerFirma}, ${order.empfaengerStreet}, ${order.empfaengerZip} ${order.empfaengerCity}`,
        abweichend
          ? `Frachtzahler: ${order.frachtzahlerFirma}, ${order.frachtzahlerStreet}, ${order.frachtzahlerZip} ${order.frachtzahlerCity}`
          : `Frachtzahler: ${full.customer.name} (Auftraggeber)`,
        full.mandant ? `Mandant: ${full.mandant.name}` : '',
        `Anhänge: ${full.documents.length} Datei(en)`,
        ...full.documents.map((d) => `- ${d.fileName}`),
        order.notes ? `Hinweis: ${order.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    try {
      await this.finalizeSubmission(full);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Nachbearbeitung Verzollungsauftrag ${order.id} fehlgeschlagen: ${msg}`);
    }

    return this.get(user, order.id);
  }

  /**
   * Soloplan-Export + sauberes PDF + E-Mail an zoll@worldofgreen.at (Anhänge inkl. PDF).
   * Kann auch für bereits erstellte Aufträge erneut aufgerufen werden.
   */
  async finalizeSubmission(orderIdOrFull: string | Awaited<ReturnType<CustomsService['get']>>) {
    const full =
      typeof orderIdOrFull === 'string'
        ? await this.prisma.customsOrder.findUnique({
            where: { id: orderIdOrFull },
            include: {
              customer: { select: { name: true, customerNumber: true } },
              mandant: { select: { name: true, code: true } },
              documents: {
                where: {
                  type: { in: [DocumentType.CUSTOMS_PAPER, DocumentType.INVOICE] },
                },
                orderBy: { createdAt: 'desc' },
                select: {
                  id: true,
                  fileName: true,
                  mimeType: true,
                  sizeBytes: true,
                  createdAt: true,
                  storagePath: true,
                  type: true,
                },
              },
            },
          })
        : orderIdOrFull;
    if (!full) throw new NotFoundException('Verzollungsauftrag nicht gefunden');

    // Soloplan FileAPI
    try {
      await this.soloplan.exportCustomsOrder(full.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Soloplan-Export Verzollungsauftrag ${full.id} fehlgeschlagen: ${msg}`);
    }

    const paperDocs = (full.documents || []).filter((d) =>
      existsSync((d as { storagePath?: string }).storagePath || ''),
    ) as Array<{
      id: string;
      fileName: string;
      mimeType: string;
      storagePath: string;
    }>;

    const grenzeWhen = formatGrenzeDateTime(full.zeit);
    const pdfFileName =
      `Verzollungsauftrag-${full.kennzeichen}-${full.id.slice(-6)}.pdf`.replace(
        /[^\w.\-]+/g,
        '_',
      );
    const pdfPath = join(this.uploadDir, pdfFileName);
    await writeVerzollungsauftragPdf(
      {
        externalNumber: full.externalNumber,
        kennzeichen: full.kennzeichen,
        zulassungsland: full.zulassungsland,
        kennzeichenAnhaenger: full.kennzeichenAnhaenger,
        zulassungslandAnhaenger: full.zulassungslandAnhaenger,
        grenzuebergang: full.grenzuebergang,
        zeit: full.zeit,
        importeur: full.importeur,
        zazKonto: full.zazKonto,
        warenort: full.warenort,
        packageCount: full.packageCount,
        weightKg: full.weightKg,
        netWeightKg: full.netWeightKg,
        goodsDescription: full.goodsDescription,
        notes: full.notes,
        driverPhone: full.driverPhone,
        smartborderNotifyEmail: full.smartborderNotifyEmail,
        smartborderSendSms: full.smartborderSendSms,
        customerName: full.customer.name,
        customerNumber: full.customer.customerNumber,
        mandantName: full.mandant?.name,
        absenderFirma: full.absenderFirma,
        absenderStreet: full.absenderStreet,
        absenderZip: full.absenderZip,
        absenderCity: full.absenderCity,
        absenderCountry: full.absenderCountry,
        empfaengerFirma: full.empfaengerFirma,
        empfaengerStreet: full.empfaengerStreet,
        empfaengerZip: full.empfaengerZip,
        empfaengerCity: full.empfaengerCity,
        empfaengerCountry: full.empfaengerCountry,
        abweichenderFrachtzahler: full.abweichenderFrachtzahler,
        frachtzahlerFirma: full.frachtzahlerFirma,
        frachtzahlerStreet: full.frachtzahlerStreet,
        frachtzahlerZip: full.frachtzahlerZip,
        frachtzahlerCity: full.frachtzahlerCity,
        frachtzahlerCountry: full.frachtzahlerCountry,
        documentNames: paperDocs.map((d) => d.fileName),
      },
      pdfPath,
    );

    const pdfDoc = await this.prisma.document.create({
      data: {
        organizationId: full.organizationId,
        customsOrderId: full.id,
        customerId: full.customerId,
        type: DocumentType.OTHER,
        fileName: pdfFileName,
        mimeType: 'application/pdf',
        storagePath: pdfPath,
        sizeBytes: statSync(pdfPath).size,
        uploadedById: full.createdById,
      },
    });

    const notifyTo =
      this.config.get<string>('CUSTOMS_NOTIFY_EMAIL') || 'zoll@worldofgreen.at';
    const subject = `${grenzeWhen} · ${full.customer.name}`;
    const body = [
      'Neuer Verzollungsauftrag im WOG Portal.',
      '',
      full.externalNumber ? `Auftrag: ${full.externalNumber}` : null,
      `Kunde: ${full.customer.name}${full.customer.customerNumber ? ` (${full.customer.customerNumber})` : ''}`,
      `Zeitpunkt an der Grenze: ${grenzeWhen}`,
      `Kennzeichen: ${full.kennzeichen}${full.zulassungsland ? ` (${full.zulassungsland})` : ''}`,
      full.kennzeichenAnhaenger
        ? `Kennzeichen Anhänger: ${full.kennzeichenAnhaenger}${
            full.zulassungslandAnhaenger ? ` (${full.zulassungslandAnhaenger})` : ''
          }`
        : null,
      `Grenzübergang: ${full.grenzuebergang}`,
      `Importeur: ${full.importeur}`,
      full.zazKonto ? `ZAZ-Konto: ${full.zazKonto}` : null,
      full.warenort ? `Warenort/Verzollungsort: ${full.warenort}` : null,
      full.packageCount != null ? `Colli: ${full.packageCount}` : null,
      full.weightKg != null ? `Bruttogewicht: ${full.weightKg} kg` : null,
      full.netWeightKg != null ? `Nettogewicht: ${full.netWeightKg} kg` : null,
      full.goodsDescription ? `Inhalt: ${full.goodsDescription}` : null,
      full.driverPhone ? `Fahrertelefon: ${full.driverPhone}` : null,
      full.smartborderNotifyEmail
        ? `E-Mail-Rückmeldung (SmartBorder): ${full.smartborderNotifyEmail}`
        : null,
      full.smartborderSendSms ? 'SmartBorder-Link per SMS: ja (an Fahrertelefon)' : null,
      `Absender: ${full.absenderFirma}, ${full.absenderStreet}, ${full.absenderZip} ${full.absenderCity}`,
      `Empfänger: ${full.empfaengerFirma}, ${full.empfaengerStreet}, ${full.empfaengerZip} ${full.empfaengerCity}`,
      full.mandant ? `Mandant: ${full.mandant.name}` : null,
      '',
      `Anhänge: ${paperDocs.length + 1} Datei(en) (inkl. Auftrags-PDF)`,
      ...paperDocs.map((d) => `- ${d.fileName}`),
      `- ${pdfFileName}`,
      '',
      `Portal: ${this.config.get('APP_URL') || 'https://wog.logistikberater.at'}`,
    ]
      .filter((line) => line != null)
      .join('\n');

    await this.notifications.sendRaw(notifyTo.trim(), subject, body, undefined, [
      {
        filename: pdfFileName,
        path: pdfPath,
        contentType: 'application/pdf',
      },
      ...paperDocs.map((d) => ({
        filename: d.fileName,
        path: d.storagePath,
        contentType: d.mimeType || 'application/octet-stream',
      })),
    ]);

    await this.audit.log(full.createdById, 'customs.submit.notify', 'CustomsOrder', full.id, {
      email: notifyTo,
      pdfDocumentId: pdfDoc.id,
      attachments: paperDocs.length + 1,
    });

    return {
      ok: true,
      email: notifyTo,
      subject,
      pdfDocumentId: pdfDoc.id,
      fileName: pdfFileName,
    };
  }

  async updateStatus(user: AuthUser, id: string, status: string) {
    if (user.role === UserRole.CUSTOMER_USER) throw new ForbiddenException();
    const current = await this.get(user, id);
    const updated = await this.prisma.customsOrder.update({
      where: { id },
      data: { status },
      include: {
        customer: true,
        mandant: true,
        documents: {
          where: { type: { in: [DocumentType.CUSTOMS_PAPER, DocumentType.INVOICE] } },
        },
      },
    });
    await this.audit.log(user.id, 'customs.status', 'CustomsOrder', id, {
      from: current.status,
      to: status,
      externalNumber: updated.externalNumber,
    });
    return updated;
  }

  /**
   * Sendungsnachfrage zu einem Verzollungsauftrag an info@worldofgreen.ch.
   */
  async requestStatusInquiry(user: AuthUser, id: string, note?: string) {
    const order = await this.get(user, id);
    const soloplanRef =
      order.soloplanRef &&
      !order.soloplanRef.startsWith('FILE:') &&
      !order.soloplanRef.startsWith('SP-STUB-')
        ? order.soloplanRef
        : null;

    const requester = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { firstName: true, lastName: true, email: true },
    });
    const requesterName =
      [requester?.firstName, requester?.lastName].filter(Boolean).join(' ') ||
      requester?.email ||
      user.email;
    const to =
      this.config.get('SHIPMENT_INQUIRY_MAIL_TO') ||
      this.config.get('CUSTOMS_NOTIFY_TO') ||
      'info@worldofgreen.ch';

    const fmt = (d?: Date | string | null) => {
      if (!d) return '–';
      const dt = typeof d === 'string' ? new Date(d) : d;
      if (Number.isNaN(dt.getTime())) return '–';
      return dt.toLocaleString('de-AT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const subject = [
      'Sendungsnachfrage Verzollung',
      order.externalNumber || order.kennzeichen,
      soloplanRef ? `Soloplan ${soloplanRef}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const body = [
      'Sendungsnachfrage (Verzollungsauftrag) aus dem WOG Kundenportal',
      '',
      'Bitte um Information zum aktuellen Status und zur voraussichtlichen bzw. erfolgten Zustellung.',
      '',
      `Anfragender: ${requesterName}`,
      `E-Mail: ${requester?.email || user.email}`,
      `Rolle: ${user.role}`,
      '',
      `Auftragsnummer (VLB): ${order.externalNumber || '–'}`,
      `Soloplan-Ordernummer: ${soloplanRef || '– (noch nicht verknüpft)'}`,
      `Kunde: ${order.customer?.name || '–'} (${order.customer?.customerNumber || '–'})`,
      `Portal-Status: ${order.status}`,
      `Kennzeichen: ${order.kennzeichen} (${order.zulassungsland || '–'})`,
      `Grenze: ${order.grenzuebergang}`,
      `Zeit Grenze: ${fmt(order.zeit)}`,
      `Importeur: ${order.importeur || '–'}`,
      `Absender: ${order.absenderFirma || '–'} (${order.absenderCountry || '–'})`,
      `Empfänger: ${order.empfaengerFirma || '–'} (${order.empfaengerCountry || '–'})`,
      '',
      note?.trim() ? `Hinweis des Kunden:\n${note.trim()}` : 'Hinweis des Kunden: (keiner)',
      '',
      `Portal: ${(this.config.get('PUBLIC_WEB_URL') || 'https://wog.logistikberater.at').replace(/\/$/, '')}/customs`,
    ].join('\n');

    await this.notifications.sendRaw(
      to,
      subject,
      body,
      undefined,
      undefined,
      { replyTo: requester?.email || user.email },
    );
    await this.audit.log(user.id, 'customs.inquiry', 'CustomsOrder', id, {
      to,
      soloplanRef,
    });

    return { ok: true, to, soloplanRef };
  }

  async uploadPapers(user: AuthUser, customsOrderId: string, files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('Keine Dateien übermittelt');
    await this.get(user, customsOrderId);
    const docs = await this.savePapers(user, customsOrderId, files, DocumentType.CUSTOMS_PAPER);
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

  private async savePapers(
    user: AuthUser,
    customsOrderId: string,
    files: Express.Multer.File[],
    type: DocumentType = DocumentType.CUSTOMS_PAPER,
  ) {
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
          type,
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
