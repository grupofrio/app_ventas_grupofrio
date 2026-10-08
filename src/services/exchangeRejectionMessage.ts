/**
 * Texto que ve el vendedor cuando el servidor rechaza un cambio.
 *
 * Un `reason` o `detail_code` conocido (también dentro de `data`, o un
 * `code` que ya es ese motivo) se traduce a español con el siguiente paso.
 * Si no hay motivo conocido, se usa el `message` humano y después
 * `user_message`. Al final, un texto genérico que incluye el código.
 *
 * El servidor de hoy manda solo `code` + `message`. Un FORBIDDEN sin el
 * motivo VAN_OTHER_BRANCH no se reescribe con la frase de la sucursal.
 */

export const VAN_OTHER_BRANCH_MESSAGE =
  'La van no pertenece a la sucursal activa. Verifica tu asignación.';

const KNOWN_REASONS = [
  'EMPLOYEE_NO_VAN',
  'PLAN_VAN_MISMATCH',
  'STOP_CLOSED',
  'PLAN_NOT_ACTIVE',
  'NOT_PLAN_MEMBER',
  'VAN_OTHER_BRANCH',
  'NO_MERMA_MAP',
  'INSUFFICIENT_STOCK',
] as const;

export type ExchangeRejectionReason = (typeof KNOWN_REASONS)[number];

const REASON_COPY: Record<Exclude<ExchangeRejectionReason, 'INSUFFICIENT_STOCK'>, string> = {
  EMPLOYEE_NO_VAN: 'Tu ficha no tiene van asignada; pide a supervisión que la asigne.',
  PLAN_VAN_MISMATCH: 'La van del plan no coincide con la de tu ficha; pide a supervisión que revise la asignación.',
  STOP_CLOSED: 'La parada ya está cerrada; registra el cambio antes del check-out.',
  PLAN_NOT_ACTIVE: 'El plan de ruta no está activo; pide a supervisión que lo reactive antes de registrar el cambio.',
  NOT_PLAN_MEMBER: 'No estás asignado a este plan; pide a supervisión que te incluya.',
  VAN_OTHER_BRANCH: VAN_OTHER_BRANCH_MESSAGE,
  NO_MERMA_MAP: 'El producto dañado no tiene equivalencia de merma; avisa a supervisión para que la configure.',
};

const LOCK_BUSY_MESSAGE = 'El sistema está ocupado. Reintenta en unos segundos.';
const SERVER_MISCONFIG_MESSAGE = 'Falta configuración en Odoo. Avisa al administrador.';

interface StockLine {
  productName: string | null;
  productId: number | null;
  availableQty: number | null;
}

interface RejectionFields {
  message: string | null;
  userMessage: string | null;
  reason: string | null;
  detailCode: string | null;
  code: string | null;
  data: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function knownReason(value: unknown): ExchangeRejectionReason | null {
  const token = text(value);
  if (!token) return null;
  const normalized = token.toUpperCase().replace(/[\s-]+/g, '_');
  return (KNOWN_REASONS as readonly string[]).includes(normalized)
    ? normalized as ExchangeRejectionReason
    : null;
}

function firstKnown(values: unknown[]): ExchangeRejectionReason | null {
  for (const value of values) {
    const reason = knownReason(value);
    if (reason) return reason;
  }
  return null;
}

function isHumanText(value: string | null): value is string {
  if (!value) return false;
  if (/^HTTP\s+\d{3}$/i.test(value)) return false;
  if (knownReason(value)) return false;
  if (/^[A-Z][A-Z0-9_]+$/.test(value)) return false;
  return true;
}

function formatQty(qty: number): string {
  const rounded = Math.round(qty * 1000) / 1000;
  return String(rounded);
}

function stockLineFrom(record: Record<string, unknown>): StockLine | null {
  const productName = text(record.product_name) ?? text(record.product);
  const productId = finiteNumber(record.product_id);
  const availableQty = finiteNumber(record.available_qty)
    ?? finiteNumber(record.available)
    ?? finiteNumber(record.qty_available)
    ?? finiteNumber(record.available_quantity);
  if (!productName && productId == null && availableQty == null) return null;
  return { productName, productId, availableQty };
}

function linesFrom(record: Record<string, unknown> | null): StockLine[] {
  if (!record || !Array.isArray(record.lines)) return [];
  return record.lines
    .filter((line): line is Record<string, unknown> => isRecord(line))
    .map(stockLineFrom)
    .filter((line): line is StockLine => line != null);
}

function readStockLines(fields: RejectionFields, top: Record<string, unknown> | null): StockLine[] {
  const fromData = linesFrom(fields.data);
  if (fromData.length > 0) return fromData;
  const fromTop = linesFrom(top);
  if (fromTop.length > 0) return fromTop;
  if (fields.data) {
    const single = stockLineFrom(fields.data);
    if (single) return [single];
  }
  if (top) {
    const single = stockLineFrom(top);
    if (single) return [single];
  }
  return [];
}

function formatStockLine(line: StockLine): string {
  const name = line.productName
    || (line.productId != null ? `Producto #${line.productId}` : 'El producto de reemplazo');
  if (line.availableQty === 0) return `${name} está agotado en la van.`;
  if (line.availableQty != null) {
    return `${name}: disponible ${formatQty(line.availableQty)} en la van.`;
  }
  return `No hay stock suficiente de ${name} en la van.`;
}

function formatInsufficientStock(fields: RejectionFields, top: Record<string, unknown> | null): string {
  const lines = readStockLines(fields, top);
  if (lines.length === 0) {
    const human = firstHuman(fields);
    if (human) return human;
    return 'No hay stock suficiente en la van para el producto de reemplazo. Elige otro producto o baja la cantidad.';
  }
  const detail = lines.map(formatStockLine).join('\n');
  return `${detail}\nElige otro producto o baja la cantidad.`;
}

function firstHuman(fields: RejectionFields): string | null {
  if (isHumanText(fields.message)) return fields.message;
  if (isHumanText(fields.userMessage)) return fields.userMessage;
  return null;
}

function genericMessage(code: string | null): string {
  const label = code && code.trim().length > 0 ? code.trim() : 'sin código';
  return `No se pudo registrar el cambio (${label}).`;
}

function readFields(error: unknown): { fields: RejectionFields; top: Record<string, unknown> | null } {
  const top = isRecord(error) ? error : null;
  const data = top && isRecord(top.data) ? top.data : null;
  const message = text(top?.message) ?? (typeof error === 'string' ? text(error) : null);
  return {
    top,
    fields: {
      message,
      userMessage: text(top?.user_message) ?? text(top?.userMessage) ?? text(data?.user_message),
      reason: text(top?.reason) ?? text(data?.reason),
      detailCode: text(top?.detail_code) ?? text(top?.detailCode) ?? text(data?.detail_code),
      code: text(top?.code) ?? text(data?.error_code),
      data,
    },
  };
}

function resolveReason(fields: RejectionFields): ExchangeRejectionReason | null {
  return firstKnown([
    fields.reason,
    fields.detailCode,
    fields.data?.reason,
    fields.data?.detail_code,
    fields.data?.error_code,
    fields.code,
  ]);
}

export function describeExchangeRejection(error: unknown): string {
  const { fields, top } = readFields(error);
  const reason = resolveReason(fields);

  if (reason === 'INSUFFICIENT_STOCK') return formatInsufficientStock(fields, top);
  if (reason) return REASON_COPY[reason];

  const human = firstHuman(fields);
  if (human) return human;

  const code = fields.code?.trim().toUpperCase() ?? '';
  if (code === 'LOCK_BUSY' || code === 'LOCKED') return LOCK_BUSY_MESSAGE;
  if (code === 'SERVER_MISCONFIG') return SERVER_MISCONFIG_MESSAGE;

  return genericMessage(fields.code);
}
