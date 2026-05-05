import assert from 'node:assert/strict';

interface OffrouteSearchModule {
  buildOffrouteResults: (
    customers: Array<{
      id: number;
      name: string;
      street?: string;
      city?: string;
      phone?: string;
      mobile?: string;
      vat?: string;
      pricelist_id?: [number, string] | false;
      property_product_pricelist?: [number, string] | false;
    }>,
    leads: Array<{
      id: number;
      name: string;
      partner_name?: string;
      phone?: string;
      mobile?: string;
      email_from?: string;
      street?: string;
      city?: string;
      partner_id?: [number, string] | false;
    }>,
  ) => Array<{
    entityType: 'customer' | 'lead';
    name: string;
    subtitle: string;
    contact: string;
    partnerId: number | null;
    pricelistId: number | null;
    pricelistName: string | null;
  }>;
}

function testCustomerMapping(module: OffrouteSearchModule) {
  const [result] = module.buildOffrouteResults(
    [{ id: 10, name: 'Miscelanea Luna', street: 'Centro', city: 'Puebla', phone: '555', vat: 'RFC1' }],
    [],
  );

  assert.equal(result.entityType, 'customer');
  assert.equal(result.name, 'Miscelanea Luna');
  assert.equal(result.subtitle, 'Centro, Puebla');
  assert.equal(result.contact, '555');
  assert.equal(result.partnerId, 10);
  assert.equal(result.pricelistId, null);
}

function testCustomerCarriesPricelist(module: OffrouteSearchModule) {
  const [result] = module.buildOffrouteResults(
    [{
      id: 55251,
      name: 'Abarrotes May',
      pricelist_id: [90, 'IGUALA LOCAL (MXN)'],
      property_product_pricelist: [1, 'Predeterminado (MXN)'],
    }],
    [],
  );

  assert.equal(result.partnerId, 55251);
  assert.equal(result.pricelistId, 90);
  assert.equal(result.pricelistName, 'IGUALA LOCAL (MXN)');
}

function testLeadMapping(module: OffrouteSearchModule) {
  const [result] = module.buildOffrouteResults(
    [],
    [{ id: 22, name: 'Lead Plaza', partner_name: 'Plaza Norte', mobile: '777', city: 'CDMX', partner_id: false }],
  );

  assert.equal(result.entityType, 'lead');
  assert.equal(result.name, 'Lead Plaza');
  assert.equal(result.subtitle, 'Plaza Norte, CDMX');
  assert.equal(result.contact, '777');
  assert.equal(result.partnerId, null);
  assert.equal(result.pricelistId, null);
}

function testMixedResultsKeepTypes(module: OffrouteSearchModule) {
  const results = module.buildOffrouteResults(
    [{ id: 10, name: 'Cliente Uno' }],
    [{ id: 22, name: 'Lead Uno', partner_id: [99, 'Partner Lead'] }],
  );

  assert.deepEqual(
    results.map((item) => item.entityType),
    ['customer', 'lead'],
  );
  assert.deepEqual(
    results.map((item) => item.partnerId),
    [10, 99],
  );
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/offrouteSearchLogic.ts', import.meta.url).pathname
  ) as OffrouteSearchModule;

  testCustomerMapping(module);
  testCustomerCarriesPricelist(module);
  testLeadMapping(module);
  testMixedResultsKeepTypes(module);
  console.log('offroute search tests: ok');
}

void main();
