import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { buildExchangeTicketSnapshot } from '../src/services/exchangeTicket.ts';

type MockPrintModule = {
  printToFileAsync: (options: {
    html: string;
    width: number;
    height: number;
    margins: { top: number; right: number; bottom: number; left: number };
  }) => Promise<{ uri: string }>;
};

type MockSharingModule = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string, options: {
    dialogTitle: string;
    mimeType: string;
    UTI: string;
  }) => Promise<void>;
};

const TEST_PRINT_KEY = '__exchangeTicketPdfTestPrint';
const TEST_SHARING_KEY = '__exchangeTicketPdfTestSharing';

function buildSnapshot(overrides: Partial<Parameters<typeof buildExchangeTicketSnapshot>[0]> = {}) {
  return buildExchangeTicketSnapshot({
    snapshotId: 'exchange-pdf-123',
    exchangeName: '',
    exchangeId: 123,
    customerName: 'Cliente PDF',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [
      { productId: 10, productName: 'Bolsa de hielo', qty: 2 },
      { productId: 11, productName: 'Hielo premium', qty: 1.5 },
    ],
    mermaLines: [
      { productId: 12, productName: 'Bolsa rota', qty: 3.25 },
    ],
    notes: '',
    ...overrides,
  });
}

function installExpoMocks(input: {
  printToFileAsync?: MockPrintModule['printToFileAsync'];
  isAvailableAsync?: MockSharingModule['isAvailableAsync'];
  shareAsync?: MockSharingModule['shareAsync'];
}) {
  (globalThis as typeof globalThis & Record<string, unknown>)[TEST_PRINT_KEY] = {
    printToFileAsync: input.printToFileAsync ?? (async () => ({ uri: 'file:///tmp/exchange-ticket.pdf' })),
  } satisfies MockPrintModule;
  (globalThis as typeof globalThis & Record<string, unknown>)[TEST_SHARING_KEY] = {
    isAvailableAsync: input.isAvailableAsync ?? (async () => true),
    shareAsync: input.shareAsync ?? (async () => {}),
  } satisfies MockSharingModule;
}

afterEach(() => {
  delete (globalThis as typeof globalThis & Record<string, unknown>)[TEST_PRINT_KEY];
  delete (globalThis as typeof globalThis & Record<string, unknown>)[TEST_SHARING_KEY];
});

test('createExchangeTicketPdf prints 58mm width, zero margins, and base height plus one line block per exchange row', async () => {
  let received:
    | {
        html: string;
        width: number;
        height: number;
        margins: { top: number; right: number; bottom: number; left: number };
      }
    | null = null;
  installExpoMocks({
    printToFileAsync: async (options) => {
      received = options;
      return { uri: 'file:///tmp/base-ticket.pdf' };
    },
  });

  const { createExchangeTicketPdf } = await import('../src/services/exchangeTicketPdf.ts');
  const uri = await createExchangeTicketPdf(buildSnapshot());

  assert.equal(uri, 'file:///tmp/base-ticket.pdf');
  if (received === null) {
    assert.fail('expected printToFileAsync to be called');
  }
  assert.equal(received.width, 164);
  assert.equal(received.height, 364);
  assert.deepEqual(received.margins, {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  assert.match(received.html, /TICKET DE CAMBIO/);
});

test('createExchangeTicketPdf adds note height based on wrapped note length', async () => {
  let receivedHeight: number | null = null;
  installExpoMocks({
    printToFileAsync: async (options) => {
      receivedHeight = options.height;
      return { uri: 'file:///tmp/notes-ticket.pdf' };
    },
  });

  const { createExchangeTicketPdf } = await import('../src/services/exchangeTicketPdf.ts');
  await createExchangeTicketPdf(buildSnapshot({
    notes: '123456789012345678901234567890123',
  }));

  assert.equal(receivedHeight, 432);
});

test('openExchangeTicketPdf shares the generated PDF with Spanish metadata', async () => {
  let shared:
    | {
        uri: string;
        options: { dialogTitle: string; mimeType: string; UTI: string };
      }
    | null = null;
  installExpoMocks({
    printToFileAsync: async () => ({ uri: 'file:///tmp/shared-ticket.pdf' }),
    shareAsync: async (uri, options) => {
      shared = { uri, options };
    },
  });

  const { openExchangeTicketPdf } = await import('../src/services/exchangeTicketPdf.ts');
  const uri = await openExchangeTicketPdf(buildSnapshot({ notes: 'Nota breve' }));

  assert.equal(uri, 'file:///tmp/shared-ticket.pdf');
  assert.deepEqual(shared, {
    uri: 'file:///tmp/shared-ticket.pdf',
    options: {
      dialogTitle: 'Abrir ticket de cambio en PDF',
      mimeType: 'application/pdf',
      UTI: '.pdf',
    },
  });
});
