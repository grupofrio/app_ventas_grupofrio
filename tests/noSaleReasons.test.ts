import assert from 'node:assert/strict';

interface NoSaleReason {
  id: number;
  label: string;
  code: string;
}

interface NoSaleReasonsModule {
  NO_SALE_REASONS: NoSaleReason[];
}

function testIncludesNewNoSaleReasons(module: NoSaleReasonsModule) {
  assert.deepEqual(
    module.NO_SALE_REASONS.slice(-2),
    [
      { id: 9, label: '❄️ No tiene conservado', code: 'no_freezer' },
      { id: 10, label: '🙅 No tiene interés', code: 'no_interest' },
    ],
    'debe incluir las nuevas razones de no-venta al final del catálogo'
  );
}

async function main() {
  const module = await import(
    new URL('../src/services/noSaleReasons.ts', import.meta.url).pathname
  ) as NoSaleReasonsModule;

  testIncludesNewNoSaleReasons(module);
  console.log('no sale reasons tests: ok');
}

void main();
