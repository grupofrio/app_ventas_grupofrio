/**
 * Pure No Venta validation + canonical catalog labels (NOT authority).
 * Odoo gf.no.sale.reason via day_bundle remains source of truth.
 */

export const CANONICAL_NO_SALE_REASON_CATALOG = [
  { code: 'closed', name: 'Cliente cerrado' },
  { code: 'has_stock', name: 'Cliente lleno de producto' },
  { code: 'limited_space', name: 'Le cabe poco producto' },
  { code: 'competitor', name: 'Lo surtió un competidor' },
  { code: 'no_contact', name: 'No está el encargado' },
  { code: 'no_display', name: 'No tiene exhibidores' },
  { code: 'freezer_broken', name: 'Está descompuesto el congelador' },
  { code: 'no_freezer', name: 'No tiene congelador' },
  { code: 'supervisor_requested', name: 'Quiere hablar con un supervisor' },
  { code: 'other', name: 'Otro' },
] as const;

export type CanonicalNoSaleReasonCode =
  (typeof CANONICAL_NO_SALE_REASON_CATALOG)[number]['code'];

export interface NoSaleValidationInput {
  reasonCode: string | null | undefined;
  notes: string | null | undefined;
  competitor: string | null | undefined;
  photoTaken: boolean;
  /** When false, competitor selector catalog is empty — typed fallback allowed. */
  competitorCatalogAvailable: boolean;
}

export type NoSaleValidationIssue =
  | 'reason_required'
  | 'photo_required'
  | 'notes_required_other'
  | 'notes_required_supervisor'
  | 'competitor_required';

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateNoSaleCapture(input: NoSaleValidationInput): NoSaleValidationIssue | null {
  const code = clean(input.reasonCode).toLowerCase();
  if (!code) return 'reason_required';
  if (!input.photoTaken) return 'photo_required';

  const notes = clean(input.notes);
  const competitor = clean(input.competitor);

  if (code === 'other' && !notes) return 'notes_required_other';
  if (code === 'supervisor_requested' && !notes) return 'notes_required_supervisor';
  if (code === 'competitor') {
    if (!competitor) return 'competitor_required';
  }
  return null;
}

export function noSaleValidationMessage(issue: NoSaleValidationIssue): string {
  switch (issue) {
    case 'reason_required':
      return 'Selecciona un motivo de no venta.';
    case 'photo_required':
      return 'La foto del punto es obligatoria.';
    case 'notes_required_other':
      return 'Especifica la causa.';
    case 'notes_required_supervisor':
      return 'Indica qué necesita revisar con el supervisor.';
    case 'competitor_required':
      return 'Selecciona el competidor (o especifícalo en notas si el catálogo no está disponible).';
    default:
      return 'Completa los datos de no venta.';
  }
}

/** FOLLOW_UP_AFTER_TASKS_BEARER — do not couple to /pwa-supv/tasks here. */
export const SUPERVISOR_REQUEST_FOLLOW_UP = 'FOLLOW_UP_AFTER_TASKS_BEARER' as const;
