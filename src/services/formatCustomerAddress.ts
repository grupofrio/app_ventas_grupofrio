/**
 * formatCustomerAddress — decide qué texto de ubicación mostrarle al operador
 * para una parada/cliente, con degradación explícita (PR dirección + nav).
 *
 * Regla de degradación:
 *   1. si hay dirección textual (o referencia/landmark) → mostrarla;
 *   2. si NO hay dirección pero sí geo válida            → "Ubicación por GPS";
 *   3. si no hay ni dirección ni geo                     → "Sin dirección registrada".
 *
 * Puro / RN-free / node-testable. NO asume que los campos nuevos ya llegan del
 * backend: todos son opcionales (forward-compatible). Hoy la mayoría vendrá
 * vacío y el operador verá "Sin dirección registrada" o "Ubicación por GPS" —
 * que ya es mejor que el silencio actual.
 */

export interface CustomerAddressFields {
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  zip?: string | null;
  // `state_name` (no `state`) a propósito: GFStop.state ya es el StopState de la
  // visita ('pending'|'done'|...). Usar `state` aquí lo contaminaría al pasar un
  // GFStop directo. `state_name` = estado/provincia de la dirección postal.
  state_name?: string | null;
  country?: string | null;
  /** Campos ya pre-formateados por backend (si alguno llega, tiene prioridad). */
  address?: string | null;
  display_address?: string | null;
  formatted_address?: string | null;
  /** Referencia operativa / entre calles / punto de referencia. */
  reference?: string | null;
  landmark?: string | null;
  location_reference?: string | null;
}

export interface CustomerGeoFields {
  customer_latitude?: number | null;
  customer_longitude?: number | null;
}

export type CustomerAddressKind = 'address' | 'geo' | 'none';

export interface FormattedCustomerAddress {
  /** 'address' = texto real · 'geo' = solo coordenadas · 'none' = nada. */
  kind: CustomerAddressKind;
  /** Línea principal a mostrar (siempre no vacía). */
  text: string;
  /** Referencia operativa secundaria, si existe y no es ya la línea principal. */
  reference: string | null;
  /** true solo cuando hay dirección/referencia textual real. */
  hasAddress: boolean;
}

export const ADDRESS_FALLBACK_GEO = 'Ubicación por GPS';
export const ADDRESS_FALLBACK_NONE = 'Sin dirección registrada';

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    const c = clean(v);
    if (c) return c;
  }
  return '';
}

/** Geo válida = ambas coordenadas finitas y no el (0,0) por defecto. */
export function hasValidGeo(geo: CustomerGeoFields | null | undefined): boolean {
  if (!geo) return false;
  const { customer_latitude: lat, customer_longitude: lon } = geo;
  return (
    typeof lat === 'number' && typeof lon === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    !(lat === 0 && lon === 0)
  );
}

/** Compone la línea de dirección textual (o '' si no hay ninguna). */
export function composeAddressText(fields: CustomerAddressFields): string {
  // Un campo ya formateado gana sobre la composición manual.
  const preformatted = firstNonEmpty(
    fields.formatted_address,
    fields.display_address,
    fields.address,
  );
  if (preformatted) return preformatted;

  return [fields.street, fields.street2, fields.city, fields.state_name, fields.zip, fields.country]
    .map(clean)
    .filter(Boolean)
    .join(', ');
}

export function formatCustomerAddress(
  fields: CustomerAddressFields | null | undefined,
  geo?: CustomerGeoFields | null,
): FormattedCustomerAddress {
  const f = fields ?? {};
  const mainAddress = composeAddressText(f);
  const referenceText = firstNonEmpty(f.location_reference, f.reference, f.landmark);

  if (mainAddress) {
    return {
      kind: 'address',
      text: mainAddress,
      // No duplicar: la referencia solo se muestra si difiere de la principal.
      reference: referenceText && referenceText !== mainAddress ? referenceText : null,
      hasAddress: true,
    };
  }

  // Sin dirección postal pero con referencia/landmark: sigue siendo info útil.
  if (referenceText) {
    return { kind: 'address', text: referenceText, reference: null, hasAddress: true };
  }

  if (hasValidGeo(geo)) {
    return { kind: 'geo', text: ADDRESS_FALLBACK_GEO, reference: null, hasAddress: false };
  }

  return { kind: 'none', text: ADDRESS_FALLBACK_NONE, reference: null, hasAddress: false };
}
