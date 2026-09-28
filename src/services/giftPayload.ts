import { requireSalesOpsIdempotencyKey } from './salesOpsMutationOutcome.ts';

export interface GiftDraftLine {
  key: string;
  productId: number | null;
  qtyText: string;
}

export interface GiftPayloadLine {
  productId: number;
  qty: number;
}

interface BuildGiftPayloadInput {
  analyticAccountId: number;
  idempotencyKey: string;
  mobileLocationId: number;
  partnerId: number;
  visitLineId?: number | null;
  lines: GiftPayloadLine[];
  notes?: string;
}

interface GetGiftSubmitIssuesInput {
  lines: GiftDraftLine[];
  partnerId: number | null;
  mobileLocationId: number | null | undefined;
  analyticAccountId: number | null | undefined;
}

interface NormalizeGiftErrorInput {
  code?: string | null;
  message?: string | null;
  userMessage?: string | null;
}

export interface GiftCreateContractPayload extends Record<string, unknown> {
  meta: { idempotency_key: string };
  data: {
    partner_id: number | null;
    visit_line_id?: number;
    lines: Array<{ product_id: number; qty: number }>;
    notes?: string;
    validate: true;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function buildGiftCreateContractPayload(
  payload: Record<string, unknown>,
): GiftCreateContractPayload {
  const metaSource = asRecord(payload.meta);
  const dataSource = asRecord(payload.data);
  const idempotencyKey = requireSalesOpsIdempotencyKey(metaSource.idempotency_key);

  const lines = Array.isArray(dataSource.lines)
    ? dataSource.lines.flatMap((candidate) => {
        const line = asRecord(candidate);
        const productId = asPositiveNumber(line.product_id);
        const qty = asPositiveNumber(line.qty);
        return productId && qty ? [{ product_id: productId, qty }] : [];
      })
    : [];
  const partnerId = asPositiveNumber(dataSource.partner_id);
  const visitLineId = asPositiveNumber(dataSource.visit_line_id);
  const notes = typeof dataSource.notes === 'string' ? dataSource.notes.trim() : '';

  return {
    meta: { idempotency_key: idempotencyKey },
    data: {
      partner_id: partnerId,
      ...(visitLineId ? { visit_line_id: visitLineId } : {}),
      lines,
      ...(notes ? { notes } : {}),
      validate: true,
    },
  };
}

function toPositiveNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function toGiftPayloadLines(lines: GiftDraftLine[]): GiftPayloadLine[] {
  return lines.flatMap((line) => {
    if (!line.productId || line.productId <= 0) return [];
    const qty = toPositiveNumber(line.qtyText);
    if (!qty) return [];
    return [{ productId: line.productId, qty }];
  });
}

export function buildGiftPayload({
  analyticAccountId,
  idempotencyKey,
  mobileLocationId,
  partnerId,
  visitLineId = null,
  lines,
  notes,
}: BuildGiftPayloadInput) {
  return buildGiftCreateContractPayload({
    meta: {
      idempotency_key: idempotencyKey,
    },
    data: {
      partner_id: partnerId,
      visit_line_id: visitLineId,
      lines: lines.map((line) => ({
        product_id: line.productId,
        qty: line.qty,
      })),
      notes: notes?.trim() || '',
      validate: true,
    },
  });
}

export function getGiftSubmitIssues({
  lines,
  partnerId,
  mobileLocationId,
  analyticAccountId,
}: GetGiftSubmitIssuesInput): string[] {
  const issues: string[] = [];

  if (!partnerId || partnerId <= 0) {
    issues.push('missing_partner');
  }
  if (!mobileLocationId || mobileLocationId <= 0) {
    issues.push('missing_mobile_location');
  }
  if (!analyticAccountId || analyticAccountId <= 0) {
    issues.push('missing_analytic_account');
  }

  const selectedProductIds = lines
    .map((line) => line.productId)
    .filter((productId): productId is number => !!productId && productId > 0);
  const uniqueProductIds = new Set(selectedProductIds);
  if (selectedProductIds.length !== uniqueProductIds.size) {
    issues.push('duplicate_products');
  }

  if (toGiftPayloadLines(lines).length === 0) {
    issues.push('no_valid_lines');
  }

  return issues;
}

export function normalizeGiftErrorMessage({
  code,
  message,
  userMessage,
}: NormalizeGiftErrorInput): string {
  if (userMessage && userMessage.trim().length > 0) return userMessage.trim();

  const fallbackCode = (message || '').trim();
  const effectiveCode = code || fallbackCode;

  switch (effectiveCode) {
    case 'VALIDATION_ERROR':
      return 'Revisa los productos y cantidades antes de registrar el regalo.';
    case 'FORBIDDEN':
      return 'La unidad móvil no pertenece a la sucursal activa.';
    case 'SERVER_MISCONFIG':
      return 'Falta configuración en Odoo para registrar el regalo. Contacta al administrador.';
    case 'LOCK_BUSY':
      return 'Otro movimiento está usando la unidad. Reintenta en unos segundos.';
    default:
      return message && message.trim().length > 0
        ? message.trim()
        : 'No se pudo registrar el regalo.';
  }
}
