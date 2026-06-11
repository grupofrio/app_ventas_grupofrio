/**
 * Lead intake desde campo (pantalla Nuevo Lead).
 * El vendedor elige GIRO (como piensa él); la app deriva el canal comercial
 * (gf.sales.channel) y lo manda estructurado + legible en description.
 *
 * Degradación segura: aunque el backend de /lead/upsert ignore los campos
 * estructurados nuevos (x_canal, giro, x_source_channel, x_prospect_source),
 * la description SIEMPRE lleva giro y canal en texto — nada se pierde.
 * El campo de WhatsApp normalizado del bot queda fuera de este flujo.
 */

export interface GiroOption {
  slug: string;
  label: string;
  /** Código real en gf.sales.channel / crm.lead.x_canal; null = requiere revisión. */
  canal: string | null;
}

export const GIRO_OPTIONS: GiroOption[] = [
  { slug: 'abarrotes_miscelanea', label: 'Abarrotes / Miscelánea', canal: 'TRADICIONAL' },
  { slug: 'modelorama_deposito', label: 'Modelorama / Depósito', canal: 'TRADICIONAL' },
  { slug: 'restaurante_fonda', label: 'Restaurante / Fonda', canal: 'CENTROS_CONSUMO' },
  { slug: 'bar_micheladas', label: 'Bar / Micheladas', canal: 'CENTROS_CONSUMO' },
  { slug: 'cafeteria', label: 'Cafetería', canal: 'CENTROS_CONSUMO' },
  { slug: 'hotel', label: 'Hotel / Motel', canal: 'CENTROS_CONSUMO' },
  { slug: 'escuela_deportivo', label: 'Escuela / Club deportivo', canal: 'CENTROS_CONSUMO' },
  { slug: 'super_conveniencia', label: 'Súper / Farmacia / Conveniencia', canal: 'RETAIL' },
  { slug: 'eventos', label: 'Eventos / Banquetes', canal: 'EVENTOS' },
  { slug: 'industria', label: 'Industria / Proceso', canal: 'INDUSTRIAL' },
  { slug: 'hogar', label: 'Hogar / Persona', canal: 'HOGAR' },
  { slug: 'otro', label: 'Otro / No sé', canal: null },
];

const CANAL_LABELS: Record<string, string> = {
  TRADICIONAL: 'Tradicional',
  CENTROS_CONSUMO: 'Centros de Consumo (HORECA)',
  RETAIL: 'Retail / Moderno',
  EVENTOS: 'Eventos',
  INDUSTRIAL: 'Industrial',
  HOGAR: 'Hogar',
};

export function giroToCanal(slug: string): string | null {
  return GIRO_OPTIONS.find((g) => g.slug === slug)?.canal ?? null;
}

/** Subtítulo visible bajo el selector: el vendedor VE a qué canal se deriva. */
export function canalHint(slug: string): string {
  if (!slug) return '';
  const canal = giroToCanal(slug);
  if (!canal) return 'Se enviará a revisión de canal';
  return `Canal: ${CANAL_LABELS[canal] ?? canal}`;
}

/**
 * Normalización SUAVE a E.164 MX: +52 + 10 dígitos cuando el valor es
 * claramente un número mexicano; si no, devuelve el texto tal cual (el alta
 * de lead NUNCA bloquea por teléfono — el cliente puede no compartirlo).
 */
export function normalizeMxPhoneSoft(value: string): string {
  const raw = (value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 12 && digits.startsWith('52')) national = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith('521')) national = digits.slice(3);
  if (!national || national[0] === '0' || national[0] === '1') return raw;
  if (new Set(national).size === 1) return raw;
  return `+52${national}`;
}

export interface NewLeadForm {
  nombre: string;
  telefono: string;
  direccion: string;
  giro: string; // slug de GIRO_OPTIONS, '' = no seleccionado
  notas: string;
}

export interface GpsPoint {
  latitude?: number | null;
  longitude?: number | null;
}

export function buildProspectionPayload(
  form: NewLeadForm,
  gps: GpsPoint,
): Record<string, unknown> {
  const giroOpt = GIRO_OPTIONS.find((g) => g.slug === form.giro) ?? null;
  const canal = giroOpt?.canal ?? null;

  const descParts = [
    giroOpt ? `Giro: ${giroOpt.label}` : '',
    giroOpt ? (canal ? `Canal: ${canal}` : 'Canal: requiere revisión') : '',
    form.notas.trim(),
  ].filter(Boolean);

  return {
    contact_name: form.nombre.trim(),
    mobile: normalizeMxPhoneSoft(form.telefono) || undefined,
    street: form.direccion.trim() || undefined,
    tag_ids: [],
    // Estructurados — el backend puede ignorarlos sin romper nada:
    giro: giroOpt?.slug || undefined,
    x_canal: canal || undefined,
    x_source_channel: 'xvan',
    x_prospect_source: 'vendedor_campo',
    description: descParts.join('\n') || undefined,
    latitude: gps.latitude || undefined,
    longitude: gps.longitude || undefined,
    _source: 'nuevo_lead_ruta',
  };
}
