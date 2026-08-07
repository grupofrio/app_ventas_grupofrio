import assert from 'node:assert/strict';

function testSaleCheckoutResult(
  getCheckoutResultStatus: (input: { saleTotal: number; noSaleReasonId: number | null }) => string,
) {
  assert.equal(
    getCheckoutResultStatus({ saleTotal: 250, noSaleReasonId: null }),
    'sale',
    'debe marcar sale cuando la visita tiene total vendido'
  );
}

function testNoSaleCheckoutResult(
  getCheckoutResultStatus: (input: { saleTotal: number; noSaleReasonId: number | null }) => string,
) {
  assert.equal(
    getCheckoutResultStatus({ saleTotal: 0, noSaleReasonId: 5 }),
    'no_sale',
    'debe marcar no_sale cuando se capturo razon de no-venta'
  );
}

function testFallbackNoSaleCheckoutResult(
  getCheckoutResultStatus: (input: { saleTotal: number; noSaleReasonId: number | null }) => string,
) {
  assert.equal(
    getCheckoutResultStatus({ saleTotal: 0, noSaleReasonId: null }),
    'no_sale',
    'debe cerrar como no_sale cuando no hubo venta'
  );
}

function testBuildCheckoutPayloadIncludesResultStatus(
  buildCheckoutPayload: (input: {
    stopId: number;
    latitude: number;
    longitude: number;
    saleTotal: number;
    noSaleReasonId: number | null;
  }) => {
    stop_id: number;
    latitude: number;
    longitude: number;
    result_status: string;
  },
) {
  assert.deepEqual(
    buildCheckoutPayload({
      stopId: 42,
      latitude: 19.4326,
      longitude: -99.1332,
      saleTotal: 0,
      noSaleReasonId: 3,
    }),
    {
      stop_id: 42,
      latitude: 19.4326,
      longitude: -99.1332,
      result_status: 'no_sale',
    },
    'debe incluir result_status en el payload de checkout'
  );
}

function testBuildCheckoutPayloadNoSaleDetail(
  buildCheckoutPayload: (input: Record<string, unknown>) => Record<string, unknown>,
) {
  // Con detalle completo: los tres campos viajan, limpios de espacios.
  assert.deepEqual(
    buildCheckoutPayload({
      stopId: 42,
      latitude: 19.4326,
      longitude: -99.1332,
      saleTotal: 0,
      noSaleReasonId: 5,
      noSaleReasonCode: ' competitor ',
      noSaleNotes: '  Llegó Crystal con hielera nueva  ',
      noSaleCompetitor: 'Crystal',
    }),
    {
      stop_id: 42,
      latitude: 19.4326,
      longitude: -99.1332,
      result_status: 'no_sale',
      no_sale_reason_code: 'competitor',
      no_sale_notes: 'Llegó Crystal con hielera nueva',
      no_sale_competitor: 'Crystal',
    },
    'el detalle de no-venta debe viajar en el payload de checkout',
  );

  // Campos vacíos no generan claves.
  assert.deepEqual(
    buildCheckoutPayload({
      stopId: 42,
      latitude: 0,
      longitude: 0,
      saleTotal: 0,
      noSaleReasonId: 1,
      noSaleReasonCode: 'closed',
      noSaleNotes: '   ',
      noSaleCompetitor: null,
    }),
    {
      stop_id: 42,
      latitude: 0,
      longitude: 0,
      result_status: 'no_sale',
      no_sale_reason_code: 'closed',
    },
    'notas vacías y competidor nulo no deben generar claves',
  );

  // Un checkout de VENTA nunca arrastra motivo de no-venta.
  assert.deepEqual(
    buildCheckoutPayload({
      stopId: 42,
      latitude: 0,
      longitude: 0,
      saleTotal: 250,
      noSaleReasonId: null,
      noSaleReasonCode: 'closed',
      noSaleNotes: 'residuo',
    }),
    {
      stop_id: 42,
      latitude: 0,
      longitude: 0,
      result_status: 'sale',
    },
    'un cierre con venta no debe incluir detalle de no-venta',
  );
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const checkoutResult = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/checkoutResult.ts', import.meta.url).pathname
  );

  testSaleCheckoutResult(checkoutResult.getCheckoutResultStatus);
  testNoSaleCheckoutResult(checkoutResult.getCheckoutResultStatus);
  testFallbackNoSaleCheckoutResult(checkoutResult.getCheckoutResultStatus);
  testBuildCheckoutPayloadIncludesResultStatus(checkoutResult.buildCheckoutPayload);
  testBuildCheckoutPayloadNoSaleDetail(checkoutResult.buildCheckoutPayload);
  console.log('checkout result tests: ok');
}

void main();
