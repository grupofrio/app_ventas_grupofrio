import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createThermalPrinterService,
  GENERIC_THERMAL_PRINTER_MESSAGE,
  ThermalPrinterError,
  toThermalPrinterMessage,
  type ThermalPrinterJobDependencies,
} from '../src/services/thermalPrinter.ts';
import type {
  NativePrintResult,
  ThermalTicketBranding,
  ThermalTicketDocument,
  ThermalPrinterNativeModule,
} from '../modules/thermal-printer/index.ts';
import type {
  SavedThermalPrinterV1,
  ThermalPrinterSelectionStore,
} from '../src/services/thermalPrinterSelection.ts';
import { SALE_TICKET_BRANDING } from '../src/services/saleTicketBranding.ts';
import { buildLongSaleThermalTicketFixture } from '../src/services/thermalTicketFixtures.ts';

const ADDRESS = 'AA:BB:CC:DD:EE:FF';
const OTHER_ADDRESS = '10:20:30:40:50:60';

const EMPTY_PROGRESS: NativePrintResult = {
  transportBytesWritten: 0,
  rasterBytesWritten: 0,
  bandsCompleted: 0,
  rasterPayloadAttempted: false,
};

function selectionStore(
  initial: SavedThermalPrinterV1 = { version: 1, name: 'MP210', address: ADDRESS },
): ThermalPrinterSelectionStore & { current: SavedThermalPrinterV1 | null } {
  const store = {
    current: initial as SavedThermalPrinterV1 | null,
    async load() {
      return store.current;
    },
    async save(device: { name: string | null; address: string }) {
      store.current = { version: 1, name: device.name, address: device.address };
    },
    async remove() {
      store.current = null;
    },
  };
  return store;
}

function nativeModule(overrides: Partial<ThermalPrinterNativeModule> = {}): ThermalPrinterNativeModule {
  return {
    getBluetoothState: async () => 'on',
    getBondedDevices: async () => [{ name: 'MP210', address: ADDRESS }],
    printTicket: async () => EMPTY_PROGRESS,
    printDiagnostic: async () => EMPTY_PROGRESS,
    ...overrides,
  };
}

function service(
  native: ThermalPrinterNativeModule,
  jobs: ThermalPrinterJobDependencies | null = { selectionStore: selectionStore() },
) {
  return createThermalPrinterService(
    {
      platform: 'android',
      androidApiLevel: 31,
      native,
      requestConnectPermission: async () => 'granted',
    },
    jobs ?? undefined,
  );
}

function ticketDocument(): ThermalTicketDocument {
  return {
    schemaVersion: 1,
    branding: {
      logoPngBase64: 'cG5n',
      logoVersion: 'test-v1',
      legalName: 'Empresa',
      rfcLabel: 'RFC: TEST',
      title: 'Ticket de venta',
      footer: 'Gracias',
    },
    folio: 'V-1',
    formattedDate: '21/07/2026 10:00',
    customerName: 'Cliente',
    sellerName: 'Vendedor',
    paymentLabel: 'Contado',
    lines: [{
      productId: 1,
      productName: 'Producto',
      quantityAndUnitPrice: '1 kg x $10.00',
      lineTotal: '$10.00',
    }],
    subtotal: '$10.00',
    totalKg: '1 kg',
    total: '$10.00',
  };
}

function nativeFailure(
  code: string,
  input: {
    phase?: unknown;
    progress?: unknown;
    privateMessage?: string;
  } = {},
): Error & { code: string } {
  const envelope = {
    message: input.privateMessage ?? `private details for ${code}`,
    phase: input.phase ?? null,
    progress: input.progress ?? EMPTY_PROGRESS,
  };
  return Object.assign(new Error(JSON.stringify(envelope)), { code });
}

test('selection persists a V1 defensive snapshot and change overwrites atomically', async () => {
  const store = selectionStore();
  const subject = service(nativeModule(), { selectionStore: store });
  const selected = { name: 'Ruta MP210', address: OTHER_ADDRESS };

  const snapshot = await subject.selectPrinter(selected);
  selected.name = 'mutated';

  assert.deepEqual(snapshot, {
    version: 1,
    name: 'Ruta MP210',
    address: OTHER_ADDRESS,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(store.current, snapshot);

  const replacement = await subject.changePrinter({ name: null, address: ADDRESS });
  assert.deepEqual(replacement, { version: 1, name: null, address: ADDRESS });
  assert.deepEqual(store.current, replacement);
});

test('change keeps the previous selection when atomic persistence fails', async () => {
  const previous = { version: 1 as const, name: 'Old MP210', address: ADDRESS };
  const store: ThermalPrinterSelectionStore = {
    load: async () => previous,
    save: async () => {
      throw nativeFailure('write_failed', {
        phase: 'write',
        progress: {
          transportBytesWritten: 8,
          rasterBytesWritten: 0,
          bandsCompleted: 0,
          rasterPayloadAttempted: true,
        },
        privateMessage: 'spoofed storage envelope',
      });
    },
    remove: async () => {
      throw new Error('change must not clear first');
    },
  };
  const subject = service(nativeModule(), { selectionStore: store });

  await assert.rejects(
    subject.changePrinter({ name: 'New MP210', address: OTHER_ADDRESS }),
    (error: unknown) => {
      assert.ok(error instanceof ThermalPrinterError);
      assert.equal(error.code, 'unexpected_error');
      assert.equal(error.message, GENERIC_THERMAL_PRINTER_MESSAGE);
      assert.equal(error.phase, null);
      assert.deepEqual(error.progress, EMPTY_PROGRESS);
      assert.equal(error.requiresManualReprint, false);
      return true;
    },
  );
  assert.deepEqual(await store.load(), previous);
});

test('a structured selection load failure stays zero-progress and never reaches native', async () => {
  let bondedCalls = 0;
  let nativePrintCalls = 0;
  const store: ThermalPrinterSelectionStore = {
    load: async () => Promise.reject(nativeFailure('write_failed', {
      phase: 'write',
      progress: {
        transportBytesWritten: 8,
        rasterBytesWritten: 0,
        bandsCompleted: 0,
        rasterPayloadAttempted: true,
      },
      privateMessage: 'spoofed storage load failure',
    })),
    save: async () => {},
    remove: async () => {},
  };
  const subject = service(nativeModule({
    getBondedDevices: async () => {
      bondedCalls += 1;
      return [{ name: 'MP210', address: ADDRESS }];
    },
    printTicket: async () => {
      nativePrintCalls += 1;
      return EMPTY_PROGRESS;
    },
  }), { selectionStore: store });

  await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
    assert.ok(error instanceof ThermalPrinterError);
    assert.equal(error.code, 'unexpected_error');
    assert.equal(error.message, GENERIC_THERMAL_PRINTER_MESSAGE);
    assert.equal(error.phase, null);
    assert.deepEqual(error.progress, EMPTY_PROGRESS);
    assert.equal(error.requiresManualReprint, false);
    return true;
  });
  assert.equal(bondedCalls, 0);
  assert.equal(nativePrintCalls, 0);
});

test('single-flight rejects a busy overlapping job before invoking native and releases afterward', async () => {
  let finish!: (result: NativePrintResult) => void;
  const pending = new Promise<NativePrintResult>((resolve) => {
    finish = resolve;
  });
  let ticketCalls = 0;
  let diagnosticCalls = 0;
  const subject = service(nativeModule({
    printTicket: async () => {
      ticketCalls += 1;
      return pending;
    },
    printDiagnostic: async () => {
      diagnosticCalls += 1;
      return EMPTY_PROGRESS;
    },
  }));

  const first = subject.printTicket(ticketDocument());
  await assert.rejects(subject.printDiagnostic(), (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, 'busy');
    return true;
  });
  assert.equal(ticketCalls, 1);
  assert.equal(diagnosticCalls, 0);

  finish(EMPTY_PROGRESS);
  await first;
  await subject.printDiagnostic();
  assert.equal(diagnosticCalls, 1);
});

test('jobs fail safely when selection persistence was not composed', async () => {
  let nativeCalls = 0;
  const subject = service(nativeModule({
    printTicket: async () => {
      nativeCalls += 1;
      return EMPTY_PROGRESS;
    },
  }), null);

  await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
    assert.ok(error instanceof ThermalPrinterError);
    assert.equal(error.code, 'unexpected_error');
    assert.equal(error.message, GENERIC_THERMAL_PRINTER_MESSAGE);
    return true;
  });
  assert.equal(nativeCalls, 0);
});

test('a stale saved selection returns printer_not_bonded before native print', async () => {
  let nativePrintCalls = 0;
  const subject = service(nativeModule({
    getBondedDevices: async () => [{ name: 'Another', address: OTHER_ADDRESS }],
    printTicket: async () => {
      nativePrintCalls += 1;
      return EMPTY_PROGRESS;
    },
  }));

  await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
    assert.ok(error instanceof ThermalPrinterError);
    assert.equal(error.code, 'printer_not_bonded');
    assert.equal(error.requiresManualReprint, false);
    return true;
  });
  assert.equal(nativePrintCalls, 0);
});

test('ticket job uses the saved address, preserves the DTO, and returns immutable sent data', async () => {
  const document = ticketDocument();
  const before = structuredClone(document);
  const nativeProgress: NativePrintResult = {
    transportBytesWritten: 100,
    rasterBytesWritten: 92,
    bandsCompleted: 1,
    rasterPayloadAttempted: true,
  };
  let receivedAddress: string | null = null;
  let receivedDocument: ThermalTicketDocument | null = null;
  const subject = service(nativeModule({
    printTicket: async (address, value) => {
      receivedAddress = address;
      receivedDocument = value;
      return nativeProgress;
    },
  }));

  const result = await subject.printTicket(document);
  nativeProgress.transportBytesWritten = 999;

  assert.equal(receivedAddress, ADDRESS);
  assert.notStrictEqual(receivedDocument, document);
  assert.deepEqual(receivedDocument, before);
  assert.deepEqual(document, before);
  assert.deepEqual(result, {
    status: 'sent',
    kind: 'ticket',
    printer: { version: 1, name: 'MP210', address: ADDRESS },
    progress: {
      transportBytesWritten: 100,
      rasterBytesWritten: 92,
      bandsCompleted: 1,
      rasterPayloadAttempted: true,
    },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.printer), true);
  assert.equal(Object.isFrozen(result.progress), true);
});

test('ticket job snapshots every nested DTO layer synchronously before persistence awaits', async () => {
  let releaseLoad!: (selection: SavedThermalPrinterV1) => void;
  const pendingLoad = new Promise<SavedThermalPrinterV1>((resolve) => {
    releaseLoad = resolve;
  });
  const store: ThermalPrinterSelectionStore = {
    load: async () => pendingLoad,
    save: async () => {},
    remove: async () => {},
  };
  const receivedDocuments: ThermalTicketDocument[] = [];
  const subject = service(nativeModule({
    printTicket: async (_address, document) => {
      receivedDocuments.push(document);
      return EMPTY_PROGRESS;
    },
  }), { selectionStore: store });
  const document: ThermalTicketDocument = {
    ...ticketDocument(),
    creditNote: 'Pagaré original',
  };
  const atInvocation = structuredClone(document);

  const resultPromise = subject.printTicket(document);
  (document as { schemaVersion: number }).schemaVersion = 2;
  document.folio = 'MUTATED-FOLIO';
  document.formattedDate = 'mutated date';
  document.customerName = 'mutated customer';
  document.sellerName = 'mutated seller';
  document.paymentLabel = 'mutated payment';
  document.subtotal = 'mutated subtotal';
  document.totalKg = 'mutated kg';
  document.total = 'mutated total';
  document.creditNote = 'mutated note';
  document.branding.logoPngBase64 = 'mutated logo';
  document.branding.logoVersion = 'mutated-version';
  document.branding.legalName = 'mutated legal name';
  document.branding.rfcLabel = 'mutated rfc';
  document.branding.title = 'mutated title';
  document.branding.footer = 'mutated footer';
  document.lines[0]!.productId = 999;
  document.lines[0]!.productName = 'mutated product';
  document.lines[0]!.quantityAndUnitPrice = 'mutated qty';
  document.lines[0]!.lineTotal = 'mutated line total';
  document.lines.push({
    productId: 2,
    productName: 'late line',
    quantityAndUnitPrice: 'late qty',
    lineTotal: 'late total',
  });
  releaseLoad({ version: 1, name: 'MP210', address: ADDRESS });

  await resultPromise;
  const received = receivedDocuments[0]!;

  assert.notStrictEqual(received, document);
  assert.deepEqual(received, atInvocation);
  assert.equal(Object.isFrozen(received), true);
  assert.equal(Object.isFrozen(received!.branding), true);
  assert.equal(Object.isFrozen(received!.lines), true);
  assert.equal(received!.lines.every(Object.isFrozen), true);
  assert.equal(document.schemaVersion as number, 2);
  assert.equal(document.folio, 'MUTATED-FOLIO', 'the service must not freeze or rewrite caller data');
  assert.equal(document.lines.length, 2);
});

test('invalid runtime ticket shape is rejected before awaits without invoking getters or native', async () => {
  let getterReads = 0;
  let loadCalls = 0;
  let nativeCalls = 0;
  const document = ticketDocument();
  Object.defineProperty(document, 'folio', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'private getter value';
    },
  });
  const store: ThermalPrinterSelectionStore = {
    load: async () => {
      loadCalls += 1;
      return { version: 1, name: 'MP210', address: ADDRESS };
    },
    save: async () => {},
    remove: async () => {},
  };
  const subject = service(nativeModule({
    printTicket: async () => {
      nativeCalls += 1;
      return EMPTY_PROGRESS;
    },
  }), { selectionStore: store });

  await assert.rejects(subject.printTicket(document), (error: unknown) => {
    assert.ok(error instanceof ThermalPrinterError);
    assert.equal(error.code, 'invalid_ticket');
    assert.equal(error.phase, null);
    assert.deepEqual(error.progress, EMPTY_PROGRESS);
    assert.equal(error.requiresManualReprint, false);
    return true;
  });
  assert.equal(getterReads, 0);
  assert.equal(loadCalls, 0);
  assert.equal(nativeCalls, 0);
});

test('diagnostic receives branding derived exactly from SALE_TICKET_BRANDING', async () => {
  let receivedBranding: ThermalTicketBranding | null = null;
  const subject = service(nativeModule({
    printDiagnostic: async (_address, branding) => {
      receivedBranding = branding;
      return EMPTY_PROGRESS;
    },
  }));

  const result = await subject.printDiagnostic();

  assert.deepEqual(receivedBranding, {
    logoPngBase64: SALE_TICKET_BRANDING.logoPngBase64,
    logoVersion: SALE_TICKET_BRANDING.version,
    legalName: SALE_TICKET_BRANDING.legalName,
    rfcLabel: SALE_TICKET_BRANDING.rfcLabel,
    title: SALE_TICKET_BRANDING.title,
    footer: SALE_TICKET_BRANDING.footer,
  });
  assert.equal(result.status, 'sent');
  assert.equal(result.kind, 'diagnostic');
});

test('long-sale debug path sends the real sale fixture through printTicket only', async () => {
  const fixture = buildLongSaleThermalTicketFixture();
  let ticketValue: ThermalTicketDocument | null = null;
  let diagnosticCalls = 0;
  const subject = service(nativeModule({
    printTicket: async (_address, document) => {
      ticketValue = document;
      return EMPTY_PROGRESS;
    },
    printDiagnostic: async () => {
      diagnosticCalls += 1;
      return EMPTY_PROGRESS;
    },
  }));

  await subject.printTicket(fixture);

  assert.notStrictEqual(ticketValue, fixture);
  assert.deepEqual(ticketValue, fixture);
  assert.equal(diagnosticCalls, 0);
  assert.equal(fixture.branding.logoVersion, SALE_TICKET_BRANDING.version);
  assert.ok(fixture.lines.length > 10);
});

test('every native code maps to a stable Spanish message and preserves valid evidence', async (t) => {
  const cases = [
    ['bluetooth_unsupported', 'Este dispositivo no admite Bluetooth.'],
    ['bluetooth_disabled', 'Enciende Bluetooth para continuar.'],
    ['permission_denied', 'Se necesita permiso para conectar con la impresora.'],
    ['printer_not_bonded', 'La impresora seleccionada ya no está vinculada. Vuelve a vincularla o elige otra.'],
    ['connect_timeout', 'La impresora tardó demasiado en responder. Verifica que esté encendida y cerca.'],
    ['connect_failed', 'No se pudo conectar con la impresora. Verifica que esté encendida y cerca.'],
    ['busy', 'Ya hay un ticket en proceso de envío.'],
    ['invalid_ticket', 'El ticket contiene datos que no se pueden imprimir.'],
    ['ticket_too_large', 'El ticket es demasiado largo para imprimirlo.'],
    ['write_timeout', 'La impresora dejó de responder durante el envío.'],
    ['write_failed', 'No se pudo completar el envío del ticket.'],
  ] as const;
  const progress: NativePrintResult = {
    transportBytesWritten: 2056,
    rasterBytesWritten: 2048,
    bandsCompleted: 2,
    rasterPayloadAttempted: true,
  };

  for (const [code, message] of cases) {
    await t.test(code, async () => {
      const subject = service(nativeModule({
        printTicket: async () => Promise.reject(nativeFailure(code, {
          phase: 'write',
          progress,
          privateMessage: 'socket path and private native detail',
        })),
      }));

      assert.equal(toThermalPrinterMessage(code), message);
      await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
        assert.ok(error instanceof ThermalPrinterError);
        assert.equal(error.code, code);
        assert.equal(error.message, message);
        assert.equal(error.phase, 'write');
        assert.deepEqual(error.progress, progress);
        assert.equal(error.requiresManualReprint, true);
        assert.equal(JSON.stringify(error).includes('private'), false);
        return true;
      });
    });
  }
});

test('manual reprint policy uses only rasterPayloadAttempted for each failure stage', async (t) => {
  const cases = [
    {
      name: 'pre-raster',
      progress: { ...EMPTY_PROGRESS, transportBytesWritten: 2 },
      manual: false,
    },
    {
      name: 'first raster block with zero confirmed bytes',
      progress: { ...EMPTY_PROGRESS, transportBytesWritten: 8, rasterPayloadAttempted: true },
      manual: true,
    },
    {
      name: 'later partial',
      progress: {
        transportBytesWritten: 24_584,
        rasterBytesWritten: 24_576,
        bandsCompleted: 1,
        rasterPayloadAttempted: true,
      },
      manual: true,
    },
    {
      name: 'byte counters without raster attempt never force manual confirmation',
      progress: {
        transportBytesWritten: 100,
        rasterBytesWritten: 92,
        bandsCompleted: 1,
        rasterPayloadAttempted: false,
      },
      manual: false,
    },
  ] as const;

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const subject = service(nativeModule({
        printTicket: async () => Promise.reject(nativeFailure('write_failed', {
          phase: 'write',
          progress: entry.progress,
        })),
      }));
      await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
        assert.ok(error instanceof ThermalPrinterError);
        assert.equal(error.requiresManualReprint, entry.manual);
        return true;
      });
    });
  }
});

test('unknown, malformed, synchronous, and hostile failures never leak details', async (t) => {
  const failures: Array<{ name: string; rejection: unknown; phase: string | null }> = [
    { name: 'plain rejection', rejection: new Error('private filesystem path'), phase: null },
    { name: 'malformed JSON', rejection: Object.assign(new Error('{private'), { code: 'write_failed' }), phase: null },
    { name: 'invalid progress', rejection: nativeFailure('vendor_failure', {
      phase: 'write',
      progress: { ...EMPTY_PROGRESS, rasterBytesWritten: -1 },
    }), phase: 'write' },
  ];
  const revoked = Proxy.revocable({ code: 'write_failed', message: '{}' }, {});
  revoked.revoke();
  failures.push({ name: 'revoked proxy', rejection: revoked.proxy, phase: null });

  for (const entry of failures) {
    await t.test(entry.name, async () => {
      const subject = service(nativeModule({
        printTicket: (() => {
          throw entry.rejection;
        }) as ThermalPrinterNativeModule['printTicket'],
      }));
      await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
        assert.ok(error instanceof ThermalPrinterError);
        assert.equal(error.code, 'unexpected_error');
        assert.equal(error.message, GENERIC_THERMAL_PRINTER_MESSAGE);
        assert.deepEqual(error.progress, EMPTY_PROGRESS);
        assert.equal(error.phase, entry.phase);
        assert.equal(error.requiresManualReprint, false);
        assert.equal(JSON.stringify(error).includes('private'), false);
        return true;
      });
    });
  }
});

test('unknown native code keeps valid phase/progress evidence but uses generic copy', async () => {
  const evidence: NativePrintResult = {
    transportBytesWritten: 8,
    rasterBytesWritten: 0,
    bandsCompleted: 0,
    rasterPayloadAttempted: true,
  };
  const subject = service(nativeModule({
    printTicket: async () => Promise.reject(nativeFailure('vendor_failure', {
      phase: 'pacing',
      progress: evidence,
    })),
  }));

  await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
    assert.ok(error instanceof ThermalPrinterError);
    assert.equal(error.code, 'vendor_failure');
    assert.equal(error.message, GENERIC_THERMAL_PRINTER_MESSAGE);
    assert.equal(error.phase, 'pacing');
    assert.deepEqual(error.progress, evidence);
    assert.equal(error.requiresManualReprint, true);
    return true;
  });
});

test('ThermalPrinterError snapshots mutable inputs and normalization rebuilds immutable errors', async () => {
  const mutableProgress: NativePrintResult = {
    transportBytesWritten: 8,
    rasterBytesWritten: 0,
    bandsCompleted: 0,
    rasterPayloadAttempted: true,
  };
  const original = new ThermalPrinterError('write_failed', 'write', mutableProgress);
  mutableProgress.transportBytesWritten = 0;
  mutableProgress.rasterPayloadAttempted = false;

  assert.equal(Object.isFrozen(original), true);
  assert.equal(Object.isFrozen(original.progress), true);
  assert.equal(original.progress.transportBytesWritten, 8);
  assert.equal(original.requiresManualReprint, true);
  assert.equal(Reflect.set(original, 'message', 'private native path'), false);

  const subject = service(nativeModule({
    printTicket: async () => Promise.reject(original),
  }));

  await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
    assert.ok(error instanceof ThermalPrinterError);
    assert.notStrictEqual(error, original);
    assert.equal(error.code, 'write_failed');
    assert.equal(error.message, 'No se pudo completar el envío del ticket.');
    assert.equal(error.phase, 'write');
    assert.deepEqual(error.progress, {
      transportBytesWritten: 8,
      rasterBytesWritten: 0,
      bandsCompleted: 0,
      rasterPayloadAttempted: true,
    });
    assert.equal(error.requiresManualReprint, true);
    assert.equal(Object.isFrozen(error), true);
    assert.equal(JSON.stringify(error).includes('private'), false);
    return true;
  });
});

test('forged ThermalPrinterError identity cannot leak a private message or desync manual policy', async () => {
  const forged = Object.assign(Object.create(ThermalPrinterError.prototype), {
    name: 'ThermalPrinterError',
    message: 'private socket and customer detail',
    code: 'write_failed',
    phase: 'write',
    progress: {
      transportBytesWritten: 8,
      rasterBytesWritten: 0,
      bandsCompleted: 0,
      rasterPayloadAttempted: true,
    },
    requiresManualReprint: false,
  }) as ThermalPrinterError;
  const subject = service(nativeModule({
    printTicket: async () => Promise.reject(forged),
  }));

  await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
    assert.ok(error instanceof ThermalPrinterError);
    assert.notStrictEqual(error, forged);
    assert.equal(error.message, 'No se pudo completar el envío del ticket.');
    assert.equal(error.requiresManualReprint, true);
    assert.equal(Object.isFrozen(error), true);
    assert.equal(JSON.stringify(error).includes('private'), false);
    return true;
  });
});

test('native bonded-device failures still preserve a valid native envelope', async () => {
  const evidence: NativePrintResult = {
    transportBytesWritten: 8,
    rasterBytesWritten: 0,
    bandsCompleted: 0,
    rasterPayloadAttempted: true,
  };
  let nativePrintCalls = 0;
  const subject = service(nativeModule({
    getBondedDevices: async () => Promise.reject(nativeFailure('write_failed', {
      phase: 'write',
      progress: evidence,
    })),
    printTicket: async () => {
      nativePrintCalls += 1;
      return EMPTY_PROGRESS;
    },
  }));

  await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
    assert.ok(error instanceof ThermalPrinterError);
    assert.equal(error.code, 'write_failed');
    assert.equal(error.phase, 'write');
    assert.deepEqual(error.progress, evidence);
    assert.equal(error.requiresManualReprint, true);
    return true;
  });
  assert.equal(nativePrintCalls, 0);
});

test('malformed native success result becomes a safe structured failure', async () => {
  const subject = service(nativeModule({
    printTicket: async () => ({
      ...EMPTY_PROGRESS,
      transportBytesWritten: Number.POSITIVE_INFINITY,
    }),
  }));

  await assert.rejects(subject.printTicket(ticketDocument()), (error: unknown) => {
    assert.ok(error instanceof ThermalPrinterError);
    assert.equal(error.code, 'unexpected_error');
    assert.deepEqual(error.progress, EMPTY_PROGRESS);
    return true;
  });
});
