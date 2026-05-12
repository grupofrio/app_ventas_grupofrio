export interface OffrouteCustomerRecord {
  id: number;
  name: string;
  street?: string;
  city?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  vat?: string;
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

export const CUSTOMER_FIELDS = [
  ...BASIC_CUSTOMER_FIELDS,
  ...CUSTOMER_PRICELIST_FIELDS,
];

export function buildCustomerSearchDomain(query: string, analyticPlazaId?: number | null): unknown[] {
  const q = query.trim();
  const domain: unknown[] = [
    '&',
    ['customer_rank', '>', 0],
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
    })),
  ];
}
