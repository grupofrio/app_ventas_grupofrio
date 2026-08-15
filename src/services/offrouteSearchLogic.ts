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
