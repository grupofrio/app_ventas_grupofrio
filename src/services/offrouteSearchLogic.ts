export interface OffrouteCustomerRecord {
  id: number;
  name: string;
  street?: string;
  city?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  vat?: string;
  partner_latitude?: number;
  partner_longitude?: number;
  google_maps_url?: string;
  pricelist_id?: [number, string] | number | false | null;
  property_product_pricelist?: [number, string] | number | false | null;
}

export interface OffrouteLeadRecord {
  id: number;
  name: string;
  partner_name?: string;
  phone?: string;
  mobile?: string;
  email_from?: string;
  street?: string;
  city?: string;
  partner_id?: [number, string] | false;
}

export interface OffrouteSearchResult {
  id: number;
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
  // Dirección textual cruda (res.partner / crm.lead). Antes solo sobrevivía
  // dentro de `subtitle` y se perdía al crear la parada virtual; ahora se
  // conserva para poder mostrarla en la parada (formatCustomerAddress).
  street: string | null;
  city: string | null;
}

export const BASIC_CUSTOMER_FIELDS = [
  'id',
  'name',
  'street',
  'city',
  'phone',
  'mobile',
  'email',
  'vat',
];

export const CUSTOMER_PRICELIST_FIELDS = [
  'pricelist_id',
  'property_product_pricelist',
];

export const CUSTOMER_LOCATION_FIELDS = [
  'partner_latitude',
  'partner_longitude',
];

export const CUSTOMER_FIELDS = [
  ...BASIC_CUSTOMER_FIELDS,
  ...CUSTOMER_PRICELIST_FIELDS,
  ...CUSTOMER_LOCATION_FIELDS,
];

const CUSTOMER_STRING_FIELDS = [
  'street',
  'city',
  'phone',
  'mobile',
  'email',
  'vat',
  'google_maps_url',
] as const;

const LEAD_STRING_FIELDS = [
  'partner_name',
  'phone',
  'mobile',
  'email_from',
  'street',
  'city',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function copySafeStrings(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, string> {
  const copied: Record<string, string> = {};
  for (const field of fields) {
    if (typeof source[field] === 'string') {
      copied[field] = source[field] as string;
    }
  }
  return copied;
}

function normalizePricelistReference(
  value: unknown,
): [number, string] | number | false | null | undefined {
  if (value === false || value === null) return value;
  const directId = positiveInteger(value);
  if (directId) return directId;
  if (!Array.isArray(value)) return undefined;
  const id = positiveInteger(value[0]);
  if (!id) return undefined;
  return [id, typeof value[1] === 'string' ? value[1] : ''];
}

function normalizeLeadPartnerReference(value: unknown): [number, string] | false {
  const directId = positiveInteger(value);
  if (directId) return [directId, ''];
  if (!Array.isArray(value)) return false;
  const id = positiveInteger(value[0]);
  if (!id) return false;
  return [id, typeof value[1] === 'string' ? value[1] : ''];
}

function normalizeDirectoryCustomer(value: unknown): OffrouteCustomerRecord | null {
  if (!isRecord(value)) return null;
  const id = positiveInteger(value.id);
  const name = typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : null;
  if (!id || !name) return null;

  const customer: OffrouteCustomerRecord = {
    id,
    name,
    ...copySafeStrings(value, CUSTOMER_STRING_FIELDS),
  };
  if (typeof value.partner_latitude === 'number' && Number.isFinite(value.partner_latitude)) {
    customer.partner_latitude = value.partner_latitude;
  }
  if (typeof value.partner_longitude === 'number' && Number.isFinite(value.partner_longitude)) {
    customer.partner_longitude = value.partner_longitude;
  }
  const pricelist = normalizePricelistReference(value.pricelist_id);
  if (pricelist !== undefined) customer.pricelist_id = pricelist;
  const propertyPricelist = normalizePricelistReference(value.property_product_pricelist);
  if (propertyPricelist !== undefined) customer.property_product_pricelist = propertyPricelist;
  return customer;
}

function normalizeDirectoryLead(value: unknown): OffrouteLeadRecord | null {
  if (!isRecord(value)) return null;
  const id = positiveInteger(value.id);
  const name = typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : null;
  if (!id || !name) return null;

  return {
    id,
    name,
    ...copySafeStrings(value, LEAD_STRING_FIELDS),
    partner_id: normalizeLeadPartnerReference(value.partner_id),
  };
}

export function normalizeOffrouteDirectoryRecords(
  customers: unknown[],
  leads: unknown[],
): { customers: OffrouteCustomerRecord[]; leads: OffrouteLeadRecord[] } {
  return {
    customers: customers
      .map(normalizeDirectoryCustomer)
      .filter((customer): customer is OffrouteCustomerRecord => customer !== null),
    leads: leads
      .map(normalizeDirectoryLead)
      .filter((lead): lead is OffrouteLeadRecord => lead !== null),
  };
}

export function buildCustomerSearchDomain(query: string, analyticPlazaId?: number | null): unknown[] {
  const q = query.trim();
  const domain: unknown[] = [
    '|', '|', '|', '|',
    ['name', 'ilike', q],
    ['phone', 'ilike', q],
    ['mobile', 'ilike', q],
    ['vat', 'ilike', q],
    ['email', 'ilike', q],
  ];

  if (typeof analyticPlazaId !== 'number' || analyticPlazaId <= 0) {
    return domain;
  }

  return ['&', ['x_analytic_un_id', '=', analyticPlazaId], ...domain];
}

export async function readCustomersWithFieldFallback(
  readers: {
    rpc: (fields: string[]) => Promise<OffrouteCustomerRecord[]>;
    read: (fields: string[]) => Promise<OffrouteCustomerRecord[]>;
  },
): Promise<OffrouteCustomerRecord[]> {
  try {
    return await readers.rpc(CUSTOMER_FIELDS);
  } catch {
    try {
      return await readers.rpc(BASIC_CUSTOMER_FIELDS);
    } catch {
      return await readers.read(BASIC_CUSTOMER_FIELDS);
    }
  }
}

function joinParts(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(', ');
}

function extractMany2oneId(value: [number, string] | number | false | null | undefined): number | null {
  if (Array.isArray(value) && typeof value[0] === 'number' && value[0] > 0) return value[0];
  if (typeof value === 'number' && value > 0) return value;
  return null;
}

function extractMany2oneName(value: [number, string] | number | false | null | undefined): string | null {
  if (Array.isArray(value) && typeof value[1] === 'string' && value[1].trim().length > 0) {
    return value[1];
  }
  return null;
}

function pickPricelist(record: {
  pricelist_id?: [number, string] | number | false | null;
  property_product_pricelist?: [number, string] | number | false | null;
}): { pricelistId: number | null; pricelistName: string | null } {
  const raw = record.pricelist_id || record.property_product_pricelist;
  return {
    pricelistId: extractMany2oneId(raw),
    pricelistName: extractMany2oneName(raw),
  };
}

export function buildOffrouteResults(
  customers: OffrouteCustomerRecord[],
  leads: OffrouteLeadRecord[],
): OffrouteSearchResult[] {
  return [
    ...customers.map((customer) => {
      const { pricelistId, pricelistName } = pickPricelist(customer);
      return {
        id: customer.id,
        entityType: 'customer' as const,
        name: customer.name,
        subtitle: joinParts(customer.street, customer.city),
        contact: customer.phone || customer.mobile || customer.email || customer.vat || '',
        partnerId: customer.id,
        pricelistId,
        pricelistName,
        customerLatitude: typeof customer.partner_latitude === 'number' ? customer.partner_latitude : null,
        customerLongitude: typeof customer.partner_longitude === 'number' ? customer.partner_longitude : null,
        googleMapsUrl: customer.google_maps_url || null,
        street: customer.street || null,
        city: customer.city || null,
      };
    }),
    ...leads.map((lead) => ({
      id: lead.id,
      entityType: 'lead' as const,
      name: lead.name,
      subtitle: joinParts(lead.partner_name, lead.street, lead.city),
      contact: lead.phone || lead.mobile || lead.email_from || '',
      partnerId: lead.partner_id ? lead.partner_id[0] : null,
      pricelistId: null,
      pricelistName: null,
      customerLatitude: null,
      customerLongitude: null,
      googleMapsUrl: null,
      street: lead.street || null,
      city: lead.city || null,
    })),
  ];
}
