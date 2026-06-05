import assert from 'node:assert/strict';

interface OffrouteSearchModule {
  BASIC_CUSTOMER_FIELDS: string[];
  CUSTOMER_FIELDS: string[];
  buildCustomerSearchDomain: (query: string, analyticPlazaId?: number | null) => unknown[];
  readCustomersWithFieldFallback: (
    readers: {
      rpc: (fields: string[]) => Promise<Array<{
        id: number;
        name: string;
        phone?: string;
      }>>;
      read: (fields: string[]) => Promise<Array<{
        id: number;
        name: string;
        phone?: string;
      }>>;
    },
  ) => Promise<Array<{
    id: number;
    name: string;
    phone?: string;
  }>>;
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
      partner_latitude?: number;
      partner_longitude?: number;
      google_maps_url?: string;
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
    customerLatitude: number | null;
    customerLongitude: number | null;
    googleMapsUrl: string | null;
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

function testCustomerCarriesNavigationLocation(module: OffrouteSearchModule) {
  const [result] = module.buildOffrouteResults(
    [{
      id: 55251,
      name: 'Pozoleria Poczo',
      partner_latitude: 18.3442,
      partner_longitude: -99.5391,
      google_maps_url: 'https://maps.google.com/?q=18.3442,-99.5391',
    }],
    [],
  );

  assert.equal(result.customerLatitude, 18.3442);
  assert.equal(result.customerLongitude, -99.5391);
  assert.equal(result.googleMapsUrl, 'https://maps.google.com/?q=18.3442,-99.5391');
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

async function testCustomerFieldFallbackKeepsResults(module: OffrouteSearchModule) {
  const calls: string[][] = [];
  const rows = await module.readCustomersWithFieldFallback({
    rpc: async (fields) => {
      calls.push(fields);
      if (fields.includes('property_product_pricelist')) {
        throw new Error('Invalid field property_product_pricelist');
      }
      return [{ id: 20, name: 'Cliente fallback', phone: '555' }];
    },
    read: async () => {
      throw new Error('should not need /get_records when basic rpc works');
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Cliente fallback');
  assert.deepEqual(calls, [module.CUSTOMER_FIELDS, module.BASIC_CUSTOMER_FIELDS]);
}

function testCustomerDomainSearchesMobileAndEmail(module: OffrouteSearchModule) {
  const domain = module.buildCustomerSearchDomain('demo', 820);

  assert.deepEqual(domain, [
    '&',
    ['x_analytic_un_id', '=', 820],
    '|', '|', '|', '|',
    ['name', 'ilike', 'demo'],
    ['phone', 'ilike', 'demo'],
    ['mobile', 'ilike', 'demo'],
    ['vat', 'ilike', 'demo'],
    ['email', 'ilike', 'demo'],
  ]);
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/offrouteSearchLogic.ts', import.meta.url).pathname
  ) as OffrouteSearchModule;

  testCustomerMapping(module);
  testCustomerCarriesPricelist(module);
  testCustomerCarriesNavigationLocation(module);
  testLeadMapping(module);
  testMixedResultsKeepTypes(module);
  await testCustomerFieldFallbackKeepsResults(module);
  testCustomerDomainSearchesMobileAndEmail(module);
  console.log('offroute search tests: ok');
}

void main();
