import assert from 'node:assert/strict';

interface GiftPayloadModule {
  buildGiftPayload: (input: {
    analyticAccountId: number;
    idempotencyKey: string;
    mobileLocationId: number;
    partnerId: number;
    visitLineId?: number | null;
    lines: Array<{ productId: number; qty: number }>;
    notes?: string;
  }) => Record<string, unknown>;
  buildGiftCreateContractPayload: (payload: Record<string, unknown>) => Record<string, unknown>;
  getGiftSubmitIssues: (input: {
    lines: Array<{ key: string; productId: number | null; qtyText: string }>;
    partnerId: number | null;
    mobileLocationId: number | null | undefined;
    analyticAccountId: number | null | undefined;
  }) => string[];
  normalizeGiftErrorMessage: (input: {
    code?: string | null;
    message?: string | null;
    userMessage?: string | null;
  }) => string;
}

function testBuildGiftPayloadAllowsNullVisitLine(module: GiftPayloadModule) {
  const payload = module.buildGiftPayload({
    analyticAccountId: 820,
    idempotencyKey: 'gift-123',
    mobileLocationId: 441,
    partnerId: 51090,
    visitLineId: null,
    lines: [{ productId: 760, qty: 1.5 }],
    notes: 'Entrega de muestra',
  });

  assert.deepEqual(payload, {
    meta: {
      idempotency_key: 'gift-123',
    },
    data: {
      partner_id: 51090,
      lines: [{ product_id: 760, qty: 1.5 }],
      notes: 'Entrega de muestra',
      validate: true,
    },
  });
}

function testQueuedGiftRetryUsesTheExactOriginalContract(module: GiftPayloadModule) {
  const original = module.buildGiftPayload({
    analyticAccountId: 820,
    idempotencyKey: 'gift-stable-123',
    mobileLocationId: 441,
    partnerId: 51090,
    visitLineId: 77,
    lines: [{ productId: 760, qty: 1 }],
    notes: 'Muestra',
  });
  const queued = {
    ...original,
    _ledgerApplied: true,
    _operationId: 'gift-stable-123',
    _localStockDelta: { 760: -1 },
  };

  assert.deepEqual(
    module.buildGiftCreateContractPayload(queued),
    module.buildGiftCreateContractPayload(original),
    'el retry debe remover metadatos locales y repetir exactamente llave+payload',
  );
}

function testBuildGiftPayloadRequiresStableIdempotencyKey(module: GiftPayloadModule) {
  assert.throws(
    () => module.buildGiftPayload({
      analyticAccountId: 820,
      idempotencyKey: '   ',
      mobileLocationId: 441,
      partnerId: 51090,
      lines: [{ productId: 760, qty: 1 }],
    }),
    /idempotent/i,
  );
}

function testSubmitIssuesBlockMissingPartnerAndDuplicates(module: GiftPayloadModule) {
  const issues = module.getGiftSubmitIssues({
    partnerId: null,
    mobileLocationId: 441,
    analyticAccountId: 820,
    lines: [
      { key: 'a', productId: 760, qtyText: '1' },
      { key: 'b', productId: 760, qtyText: '2' },
    ],
  });

  assert.deepEqual(issues, ['missing_partner', 'duplicate_products']);
}

function testSubmitIssuesRequireAtLeastOneValidLine(module: GiftPayloadModule) {
  const issues = module.getGiftSubmitIssues({
    partnerId: 51090,
    mobileLocationId: 441,
    analyticAccountId: 820,
    lines: [
      { key: 'a', productId: 760, qtyText: '0' },
      { key: 'b', productId: null, qtyText: '' },
    ],
  });

  assert.deepEqual(issues, ['no_valid_lines']);
}

function testSubmitIssuesRequireOperationalIds(module: GiftPayloadModule) {
  const issues = module.getGiftSubmitIssues({
    partnerId: 51090,
    mobileLocationId: null,
    analyticAccountId: null,
    lines: [{ key: 'a', productId: 760, qtyText: '1' }],
  });

  assert.deepEqual(issues, ['missing_mobile_location', 'missing_analytic_account']);
}

function testNormalizeGiftErrorMessage(module: GiftPayloadModule) {
  assert.equal(
    module.normalizeGiftErrorMessage({ code: 'LOCK_BUSY' }),
    'Otro movimiento está usando la unidad. Reintenta en unos segundos.',
  );
  assert.equal(
    module.normalizeGiftErrorMessage({ code: 'SERVER_MISCONFIG' }),
    'Falta configuración en Odoo para registrar el regalo. Contacta al administrador.',
  );
  assert.equal(
    module.normalizeGiftErrorMessage({ message: 'Mensaje backend' }),
    'Mensaje backend',
  );
}

async function main() {
  const module = await import(
    new URL('../src/services/giftPayload.ts', import.meta.url).pathname
  ) as GiftPayloadModule;

  testBuildGiftPayloadAllowsNullVisitLine(module);
  testBuildGiftPayloadRequiresStableIdempotencyKey(module);
  testQueuedGiftRetryUsesTheExactOriginalContract(module);
  testSubmitIssuesBlockMissingPartnerAndDuplicates(module);
  testSubmitIssuesRequireAtLeastOneValidLine(module);
  testSubmitIssuesRequireOperationalIds(module);
  testNormalizeGiftErrorMessage(module);
  console.log('gift payload tests: ok');
}

void main();
