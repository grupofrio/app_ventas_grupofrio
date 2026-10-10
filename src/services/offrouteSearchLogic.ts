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

export interface OffrouteDirectorySearchable {
  name: string;
  address?: string;
  zone?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  vat?: string;
  rfc?: string;
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

function joinParts(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(', ');
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesOffrouteDirectoryQuery(
  query: string,
  entry: OffrouteDirectorySearchable,
): boolean {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return false;
  const searchable = normalizeSearchText([
    entry.name,
    entry.address ?? '',
    entry.zone ?? '',
    entry.phone ?? '',
    entry.mobile ?? '',
    entry.email ?? '',
    entry.vat ?? '',
    entry.rfc ?? '',
  ].join(' '));
  return tokens.every((token) => searchable.includes(token));
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

function pickPricelist(record: Pick<OffrouteCustomerRecord, 'pricelist_id'>): {
  pricelistId: number | null;
  pricelistName: string | null;
} {
  const raw = record.pricelist_id;
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

function textField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && value > 0) return value;
    if (Array.isArray(value) && typeof value[0] === 'number' && value[0] > 0) return value[0];
  }
  return null;
}

function mapDirectoryRows(
  rows: unknown,
  entityType: 'customer' | 'lead',
): OffrouteSearchResult[] {
  if (!Array.isArray(rows)) return [];
  const customers: OffrouteCustomerRecord[] = [];
  const leads: OffrouteLeadRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const id = numberField(record, 'id', 'partner_id', 'lead_id');
    const name = textField(record, 'name', 'partner_name', 'display_name');
    if (!id || !name) continue;
    if (entityType === 'customer') {
      customers.push({
        id,
        name,
        street: textField(record, 'street', 'address') || undefined,
        city: textField(record, 'city', 'zone') || undefined,
        phone: textField(record, 'phone') || undefined,
        mobile: textField(record, 'mobile') || undefined,
        email: textField(record, 'email') || undefined,
        vat: textField(record, 'vat', 'rfc') || undefined,
        partner_latitude: typeof record.partner_latitude === 'number'
          ? record.partner_latitude
          : typeof record.latitude === 'number' ? record.latitude : undefined,
        partner_longitude: typeof record.partner_longitude === 'number'
          ? record.partner_longitude
          : typeof record.longitude === 'number' ? record.longitude : undefined,
      });
    } else {
      const partnerId = numberField(record, 'partner_id');
      leads.push({
        id,
        name,
        partner_name: textField(record, 'partner_name') || undefined,
        phone: textField(record, 'phone') || undefined,
        mobile: textField(record, 'mobile') || undefined,
        email_from: textField(record, 'email_from', 'email') || undefined,
        street: textField(record, 'street', 'address') || undefined,
        city: textField(record, 'city') || undefined,
        partner_id: partnerId ? [partnerId, textField(record, 'partner_name') || name] : false,
      });
    }
  }
  return entityType === 'customer'
    ? buildOffrouteResults(customers, [])
    : buildOffrouteResults([], leads);
}

/** Accept the shapes the directory endpoint has used in the field. */
export function parseDirectorySearchResponse(payload: unknown): OffrouteSearchResult[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const customers = mapDirectoryRows(
    data.customers ?? data.partners ?? data.customer,
    'customer',
  );
  const leads = mapDirectoryRows(
    data.leads ?? data.prospects ?? data.lead,
    'lead',
  );
  return mergeOffrouteSearchResults(customers, leads);
}

export function mergeOffrouteSearchResults(
  ...groups: OffrouteSearchResult[][]
): OffrouteSearchResult[] {
  const seen = new Set<string>();
  const merged: OffrouteSearchResult[] = [];
  for (const group of groups) {
    for (const result of group) {
      const key = `${result.entityType}:${result.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(result);
      if (merged.length >= 20) return merged;
    }
  }
  return merged;
}
