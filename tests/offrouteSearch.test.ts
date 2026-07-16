import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  normalizeOffrouteDirectoryRecords?: (
    customers: unknown[],
    leads: unknown[],
  ) => {
    customers: Array<Record<string, unknown>>;
    leads: Array<Record<string, unknown>>;
  };
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

function testSearchUsesEmployeeScopedDirectory() {
  const source = readFileSync(resolve(process.cwd(), 'src/services/offrouteSearch.ts'), 'utf8');
  assert.match(source, /searchEmployeeDirectory/, 'la búsqueda debe usar directorio scoped');
  assert.doesNotMatch(source, /odooRpc|odooRead/, 'la búsqueda no debe usar ORM/RPC directo');
  assert.doesNotMatch(source, /buildCustomerSearchDomain\(q/, 'la búsqueda no debe construir dominio client-side');
  assert.match(source, /normalizeOffrouteDirectoryRecords\(customers,\s*leads\)/, 'los datos REST desconocidos deben normalizarse antes de mapearlos');
}

function testDirectoryNormalizerDropsUnsafeFieldsBeforeUiMapping(module: OffrouteSearchModule) {
  const normalize = module.normalizeOffrouteDirectoryRecords;
  assert.equal(typeof normalize, 'function', 'debe normalizar la respuesta no confiable del directorio');
  if (typeof normalize !== 'function') return;

  const normalized = normalize(
    [
      {
        id: 10,
        name: 'Cliente seguro',
        mobile: '7331112233',
        phone: { unsafe: true },
        google_maps_url: { unsafe: true },
        partner_latitude: '18.3',
        partner_longitude: -99.5,
        pricelist_id: [7, 42],
        property_product_pricelist: ['bad', 'No usar'],
      },
      { id: '11', name: 'Cliente inválido' },
    ],
    [
      {
        id: 20,
        name: 'Lead seguro',
        partner_name: ['unsafe'],
        phone: ['unsafe'],
        mobile: '7330001122',
        partner_id: 88,
      },
      { id: 21, name: 99, partner_id: [3, 'No usar'] },
    ],
  );

  assert.deepEqual(normalized, {
    customers: [{
      id: 10,
      name: 'Cliente seguro',
      mobile: '7331112233',
      partner_longitude: -99.5,
      pricelist_id: [7, ''],
    }],
    leads: [{
      id: 20,
      name: 'Lead seguro',
      mobile: '7330001122',
      partner_id: [88, ''],
    }],
  });

  const results = module.buildOffrouteResults(normalized.customers as never[], normalized.leads as never[]);
  assert.deepEqual(results, [{
    id: 10,
    entityType: 'customer',
    name: 'Cliente seguro',
    subtitle: '',
    contact: '7331112233',
    partnerId: 10,
    pricelistId: 7,
    pricelistName: null,
    customerLatitude: null,
    customerLongitude: -99.5,
    googleMapsUrl: null,
  }, {
    id: 20,
    entityType: 'lead',
    name: 'Lead seguro',
    subtitle: '',
    contact: '7330001122',
    partnerId: 88,
    pricelistId: null,
    pricelistName: null,
    customerLatitude: null,
    customerLongitude: null,
    googleMapsUrl: null,
  }]);
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
  testSearchUsesEmployeeScopedDirectory();
  testDirectoryNormalizerDropsUnsafeFieldsBeforeUiMapping(module);
  console.log('offroute search tests: ok');
}

void main();
