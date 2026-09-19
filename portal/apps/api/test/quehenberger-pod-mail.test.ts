import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  QUEHENBERGER_CUSTOMER_NUMBER,
  QuehenbergerPodMailService,
} from '../src/integrations/quehenberger-pod-mail.service';

function makeService(overrides?: {
  customerNumber?: string;
  alreadySent?: boolean;
  sendRaw?: ReturnType<typeof mock.fn>;
}) {
  const tmp = mkdtempSync(join(tmpdir(), 'q-pod-'));
  const pdfPath = join(tmp, 'Ablieferbeleg-TEST.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-1.4 test'));

  const sendRaw =
    overrides?.sendRaw ||
    mock.fn(async () => ({ id: 'outbox-1' }));

  const prisma = {
    emailOutbox: {
      findFirst: mock.fn(async () =>
        overrides?.alreadySent ? { id: 'dup' } : null,
      ),
    },
    customer: {
      findUnique: mock.fn(async () => null),
    },
    shipment: {
      findFirst: mock.fn(async () => null),
      findUnique: mock.fn(async () => ({ organizationId: 'org-1' })),
    },
    document: {
      findFirst: mock.fn(async () => null),
      create: mock.fn(async () => ({ id: 'doc-1' })),
      update: mock.fn(async () => ({ id: 'doc-1' })),
    },
  };

  const config = {
    get: (key: string) => {
      if (key === 'QUEHENBERGER_POD_MAIL_TO') {
        return 'christian.kerschbaumer@quehenberger.com';
      }
      if (key === 'QUEHENBERGER_POD_MAIL_CC') {
        return 'marcel.burtscher@worldofgreen.ch';
      }
      if (key === 'APP_URL') return 'https://portal.test';
      return undefined;
    },
  };

  const notifications = {
    normalizeEmails: (raw?: string | string[] | null) => {
      if (!raw) return [];
      const s = Array.isArray(raw) ? raw.join(',') : String(raw);
      return s
        .split(/[,;]+/)
        .map((e) => e.trim())
        .filter(Boolean);
    },
    sendRaw,
  };

  const svc = new QuehenbergerPodMailService(
    prisma as any,
    config as any,
    notifications as any,
  );

  return {
    svc,
    prisma,
    sendRaw,
    pdfPath,
    tmp,
    customerNumber: overrides?.customerNumber ?? QUEHENBERGER_CUSTOMER_NUMBER,
  };
}

describe('QuehenbergerPodMailService', () => {
  it('erkennt Kundennummer 4390', () => {
    const { svc } = makeService();
    assert.equal(svc.isQuehenbergerCustomerNumber('4390'), true);
    assert.equal(svc.isQuehenbergerCustomerNumber(' 4390 '), true);
    assert.equal(svc.isQuehenbergerCustomerNumber('1234'), false);
    assert.equal(svc.isQuehenbergerCustomerNumber(null), false);
  });

  it('sendet POD-Mail für Quehenberger (Zustellapp)', async () => {
    const { svc, sendRaw, pdfPath, tmp, customerNumber } = makeService();
    try {
      const result = await svc.notifyIfQuehenberger({
        shipment: {
          id: 'sh-1',
          trackingNumber: 'WOG2609TEST',
          soloplanRef: '440001.1',
          customerId: 'cust-1',
          organizationId: 'org-1',
          customer: {
            id: 'cust-1',
            customerNumber,
            name: 'Quehenberger Logistics',
          },
        },
        fileName: 'Ablieferbeleg-WOG2609TEST.pdf',
        storagePath: pdfPath,
        mimeType: 'application/pdf',
        source: 'Zustellapp',
        ensurePortalDocument: false,
      });
      assert.equal(result, 'sent');
      assert.equal(sendRaw.mock.callCount(), 1);
      const args = sendRaw.mock.calls[0].arguments;
      assert.match(String(args[0]), /quehenberger/i);
      assert.equal(args[1], 'POD verfügbar WOG2609TEST');
      assert.match(String(args[2]), /Zustellapp/);
      assert.equal(args[4][0].path, pdfPath);
      assert.deepEqual(args[5]?.cc, ['marcel.burtscher@worldofgreen.ch']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('überspringt Nicht-Quehenberger', async () => {
    const { svc, sendRaw, pdfPath, tmp } = makeService({
      customerNumber: '9999',
    });
    try {
      const result = await svc.notifyIfQuehenberger({
        shipment: {
          id: 'sh-2',
          trackingNumber: 'WOGOTHER',
          customer: { customerNumber: '9999', name: 'Andere' },
        },
        fileName: 'x.pdf',
        storagePath: pdfPath,
        source: 'BT Swiss',
        ensurePortalDocument: false,
      });
      assert.equal(result, 'skipped_not_quehenberger');
      assert.equal(sendRaw.mock.callCount(), 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('überspringt Doppelmail (bereits gesendet)', async () => {
    const { svc, sendRaw, pdfPath, tmp } = makeService({ alreadySent: true });
    try {
      const result = await svc.notifyIfQuehenberger({
        shipment: {
          id: 'sh-3',
          trackingNumber: 'WOG2609DUP',
          customer: {
            customerNumber: QUEHENBERGER_CUSTOMER_NUMBER,
            name: 'Quehenberger',
          },
        },
        fileName: 'x.pdf',
        storagePath: pdfPath,
        source: 'Post',
        ensurePortalDocument: false,
      });
      assert.equal(result, 'skipped_duplicate');
      assert.equal(sendRaw.mock.callCount(), 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('notifyForRefs ohne Sendung → skipped_no_shipment', async () => {
    const { svc, pdfPath, tmp } = makeService();
    try {
      const result = await svc.notifyForRefs({
        refs: ['unknown-order'],
        fileName: 'Ablieferbeleg-x.pdf',
        storagePath: pdfPath,
        source: 'BT Swiss',
      });
      assert.equal(result, 'skipped_no_shipment');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
