/**
 * Seller-facing status for the blind leftover receipt (gf#315).
 *
 * The seller never counts or edits the return. When the branch switch is off,
 * or the backend has no receipt yet, callers keep today's screens.
 */

export type RouteReturnStatusCode =
  | 'pending_reception'
  | 'received'
  | 'received_with_difference'
  | 'resolved';

export interface RouteLeftoverReceipt {
  plan_id: number | null;
  plan_name: string | null;
  blind_receipt_enabled: boolean;
  status: RouteReturnStatusCode | null;
  status_label: string | null;
  received_by_id: number | null;
  received_by: string | null;
  received_at: string | null;
  resolved_by_id: number | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution: string | null;
  can_edit: boolean;
}

export const ROUTE_RETURN_STATUS_LABELS = {
  pending_reception: 'Pendiente de recepción en Almacén',
  received: 'Recibido en Almacén',
  received_with_difference: 'Recibido con diferencia, pendiente del supervisor',
  resolved: 'Diferencia resuelta',
} as const;

/** Next step when close is blocked because Almacén has not received the unit. */
export const WAREHOUSE_HANDOFF_ACTION = 'Entrega el producto a Almacén y espera a que lo reciba';

/** Next step when the unit was received and a supervisor still has to resolve a difference. */
export const SUPERVISOR_WAIT_ACTION = 'Espera a que el supervisor resuelva la diferencia. La ruta no se cierra hasta entonces.';

const STATUS_CODES = new Set<RouteReturnStatusCode>([
  'pending_reception',
  'received',
  'received_with_difference',
  'resolved',
]);

const RETURN_CLOSE_WARNING = [
  /pendiente de recepción en Almacén/i,
  /pendiente de resolución del supervisor/i,
  /la unidad todavía tiene producto/i,
];

export interface RouteReturnCloseGuidance {
  warning: string;
  action: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function idOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function statusOrNull(value: unknown): RouteReturnStatusCode | null {
  return typeof value === 'string' && STATUS_CODES.has(value as RouteReturnStatusCode)
    ? value as RouteReturnStatusCode
    : null;
}

function hasExplicitTimeZone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

/**
 * Clock shown next to a warehouse keeper's name. ISO instants are rendered in
 * Mexico City. Strings the backend already formatted (no zone) stay as-is.
 */
export function formatRouteReturnClock(value: string | null | undefined): string | null {
  const trimmed = textOrNull(value);
  if (!trimmed) return null;
  if (!hasExplicitTimeZone(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return trimmed;
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(parsed));
  } catch {
    return trimmed;
  }
}

export function parseLeftoverReceipt(raw: unknown): RouteLeftoverReceipt | null {
  if (!isRecord(raw)) return null;
  const looksLikeReceipt = 'blind_receipt_enabled' in raw
    || 'status' in raw
    || 'status_label' in raw;
  if (!looksLikeReceipt) return null;
  return {
    plan_id: idOrNull(raw.plan_id),
    plan_name: textOrNull(raw.plan_name),
    blind_receipt_enabled: raw.blind_receipt_enabled === true,
    status: statusOrNull(raw.status),
    status_label: textOrNull(raw.status_label),
    received_by_id: idOrNull(raw.received_by_id),
    received_by: textOrNull(raw.received_by),
    received_at: textOrNull(raw.received_at),
    resolved_by_id: idOrNull(raw.resolved_by_id),
    resolved_by: textOrNull(raw.resolved_by),
    resolved_at: textOrNull(raw.resolved_at),
    resolution: textOrNull(raw.resolution),
    can_edit: raw.can_edit === true,
  };
}

/** The seller is never the one who counts or corrects the return. */
export function sellerCanEditReturn(_receipt: RouteLeftoverReceipt | null | undefined): boolean {
  return false;
}

export function blindReceiptIsOn(receipt: RouteLeftoverReceipt | null | undefined): boolean {
  return receipt?.blind_receipt_enabled === true;
}

/**
 * Label for the seller. Null when the switch is off or there is no receipt
 * yet — the screen stays as it is today.
 */
export function formatSellerReturnStatus(
  receipt: RouteLeftoverReceipt | null | undefined,
): string | null {
  if (!receipt?.blind_receipt_enabled || !receipt.status) return null;
  if (receipt.status === 'received') {
    const who = receipt.received_by;
    const when = formatRouteReturnClock(receipt.received_at);
    if (who && when) return `Recibido en Almacén por ${who} ${when}`;
    if (who) return `Recibido en Almacén por ${who}`;
    return receipt.status_label ?? ROUTE_RETURN_STATUS_LABELS.received;
  }
  return receipt.status_label ?? ROUTE_RETURN_STATUS_LABELS[receipt.status];
}

export function isRouteReturnCloseWarning(message: string | null | undefined): boolean {
  const text = textOrNull(message);
  if (!text) return false;
  return RETURN_CLOSE_WARNING.some((pattern) => pattern.test(text));
}

export function routeReturnCloseGuidance(
  message: string | null | undefined,
): RouteReturnCloseGuidance | null {
  const warning = textOrNull(message);
  if (!warning || !isRouteReturnCloseWarning(warning)) return null;
  const waitingOnSupervisor = warning.toLowerCase().includes('supervisor')
    && !warning.toLowerCase().includes('la unidad todavía tiene producto');
  return {
    warning,
    action: waitingOnSupervisor ? SUPERVISOR_WAIT_ACTION : WAREHOUSE_HANDOFF_ACTION,
  };
}

const GUIDANCE_BY_STATUS: Partial<Record<RouteReturnStatusCode, string>> = {
  pending_reception: 'No se puede cerrar la ruta: la devolución de la unidad está pendiente de recepción en Almacén.',
  received_with_difference: 'No se puede cerrar la ruta: la diferencia de la devolución está pendiente de resolución del supervisor.',
};

/**
 * Prefer the backend's route_close_warning. Before that call returns, the
 * embedded status already tells the seller the same block.
 */
export function routeReturnClosePresentation(input: {
  warning?: string | null;
  receipt?: RouteLeftoverReceipt | null;
}): RouteReturnCloseGuidance | null {
  const fromWarning = routeReturnCloseGuidance(input.warning);
  if (fromWarning) return fromWarning;
  const receipt = input.receipt;
  if (!receipt?.blind_receipt_enabled || !receipt.status) return null;
  const derived = GUIDANCE_BY_STATUS[receipt.status];
  return derived ? routeReturnCloseGuidance(derived) : null;
}
