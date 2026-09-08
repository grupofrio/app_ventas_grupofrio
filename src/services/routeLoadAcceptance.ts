const PENDING_LOAD_STATES = new Set(['confirmed', 'assigned', 'waiting', 'partially_available', 'draft']);

export const ROUTE_LOAD_REJECTION_REASON_CODES = [
  'physical_difference',
  'wrong_product',
  'wrong_quantity',
  'damaged_product',
  'load_not_received',
  'other',
] as const;

export type RouteLoadRejectionReasonCode = typeof ROUTE_LOAD_REJECTION_REASON_CODES[number];

export const ROUTE_LOAD_REJECTION_REASON_LABELS: Record<RouteLoadRejectionReasonCode, string> = {
  physical_difference: 'Diferencia física',
  wrong_product: 'Producto incorrecto',
  wrong_quantity: 'Cantidad incorrecta',
  damaged_product: 'Producto dañado',
  load_not_received: 'No recibí la carga',
  other: 'Otro',
};

export interface RouteLoadCard {
  id: number;
  picking_id: number;
  name: string;
  state: string;
  accepted: boolean;
  rejected: boolean;
  rejection_reason_code: string;
  load_kind: string;
  isRefill: boolean;
  scheduled_date: string;
  lines: RouteLoadLine[];
}

export interface RouteLoadLine {
  move_id: number;
  product_id: number;
  product_name: string;
  requested_qty: number;
  done_qty: number;
  quantity: number;
  display_qty: number;
  uom_name: string;
  state: string;
}

export interface RouteLoadAcceptanceState {
  loadCards: RouteLoadCard[];
  pendingLoads: RouteLoadCard[];
  acceptedLoads: RouteLoadCard[];
  rejectedLoads: RouteLoadCard[];
  hasPendingLoad: boolean;
  nextPendingLoad: RouteLoadCard | null;
}

export interface InitialLoadAcceptanceState {
  initialLoads: RouteLoadCard[];
  pendingInitialLoads: RouteLoadCard[];
  rejectedInitialLoads: RouteLoadCard[];
  initialLoadAccepted: boolean;
  initialLoadRejectedWaiting: boolean;
  nextPendingInitialLoad: RouteLoadCard | null;
}

function toPositiveNumber(value: unknown): number {
  if (Array.isArray(value)) return toPositiveNumber(value[0]);
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function inferInitialPickingId(plan: any, rawCards: any[]): number {
  const direct = toPositiveNumber(plan?.load_picking_id);
  if (direct) return direct;
  const initial = rawCards.find((raw) => (
    String(raw?.load_kind || raw?.gf_route_load_kind || '') === 'initial'
  ));
  return toPositiveNumber(initial?.picking_id || initial?.id || initial?.load_picking_id);
}

function normalizeLoadLine(raw: any): RouteLoadLine | null {
  const productId = toPositiveNumber(raw?.product_id);
  const requestedQty = Number(raw?.requested_qty ?? raw?.product_uom_qty ?? 0);
  const doneQty = Number(raw?.done_qty ?? raw?.quantity ?? 0);
  const displayQty = Number(raw?.display_qty ?? (doneQty || requestedQty || 0));

  if (!productId && !raw?.product_name) return null;

  return {
    move_id: toPositiveNumber(raw?.move_id || raw?.id),
    product_id: productId,
    product_name: String(raw?.product_name || raw?.name || `Producto ${productId}`),
    requested_qty: Number.isFinite(requestedQty) ? requestedQty : 0,
    done_qty: Number.isFinite(doneQty) ? doneQty : 0,
    quantity: Number.isFinite(doneQty) ? doneQty : 0,
    display_qty: Number.isFinite(displayQty) ? displayQty : 0,
    uom_name: String(raw?.uom_name || raw?.uom || ''),
    state: String(raw?.state || ''),
  };
}

function isRejectedRaw(raw: any): boolean {
  return raw?.rejected === true || raw?.gf_route_load_rejected === true;
}

function isAcceptedRaw(raw: any): boolean {
  if (isRejectedRaw(raw)) return false;
  return raw?.accepted === true || raw?.gf_route_load_accepted === true;
}

function normalizeLoadCard(raw: any, initialPickingId: number, hasMultipleCards: boolean): RouteLoadCard | null {
  const pickingId = toPositiveNumber(raw?.picking_id || raw?.id || raw?.load_picking_id);
  if (!pickingId) return null;

  const rejected = isRejectedRaw(raw);
  const accepted = isAcceptedRaw(raw);
  const fieldKind = String(raw?.load_kind || raw?.gf_route_load_kind || '');
  const loadKind = pickingId === initialPickingId
    ? 'initial'
    : (fieldKind === 'refill' || hasMultipleCards ? 'refill' : (fieldKind || 'initial'));

  return {
    ...raw,
    id: pickingId,
    picking_id: pickingId,
    name: String(raw?.name || raw?.picking_name || `Picking ${pickingId}`),
    state: String(raw?.state || raw?.picking_state || ''),
    accepted,
    rejected,
    rejection_reason_code: String(raw?.rejection_reason_code || ''),
    load_kind: loadKind,
    isRefill: loadKind === 'refill',
    scheduled_date: String(raw?.scheduled_date || raw?.create_date || ''),
    lines: Array.isArray(raw?.lines)
      ? raw.lines
          .map((line: unknown) => normalizeLoadLine(line))
          .filter((line: RouteLoadLine | null): line is RouteLoadLine => !!line)
      : [],
  };
}

function isPendingLoadCard(card: RouteLoadCard): boolean {
  if (card.accepted === true) return false;
  if (card.rejected === true) return false;
  if (!card.state) return true;
  return PENDING_LOAD_STATES.has(card.state);
}

export function isRouteLoadRejectionReasonCode(
  value: unknown,
): value is RouteLoadRejectionReasonCode {
  return typeof value === 'string'
    && (ROUTE_LOAD_REJECTION_REASON_CODES as readonly string[]).includes(value);
}

export function createRouteLoadOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function buildRouteLoadAcceptPayload(routePlanId: number, pickingId: number): Record<string, number> {
  return {
    plan_id: Number(routePlanId),
    route_plan_id: Number(routePlanId),
    picking_id: Number(pickingId),
  };
}

export function buildRouteLoadRejectPayload(input: {
  planId: number;
  pickingId: number;
  operationId: string;
  rejectionReasonCode: string;
  rejectionNotes?: string;
}): Record<string, string | number> {
  const notes = (input.rejectionNotes || '').trim();
  if (!isRouteLoadRejectionReasonCode(input.rejectionReasonCode)) {
    throw new Error('Motivo de rechazo inválido.');
  }
  if (input.rejectionReasonCode === 'other' && !notes) {
    throw new Error("Escribe una nota cuando el motivo es 'Otro'.");
  }
  if (notes.length > 2000) {
    throw new Error('Las notas de rechazo no pueden exceder 2000 caracteres.');
  }
  const operationId = String(input.operationId || '').trim();
  if (!operationId) {
    throw new Error('operation_id es obligatorio para rechazar la carga.');
  }
  return {
    operation_id: operationId,
    plan_id: Number(input.planId),
    picking_id: Number(input.pickingId),
    rejection_reason_code: input.rejectionReasonCode,
    rejection_notes: notes,
  };
}

function mergeLoadCards(plan: any): Map<number, RouteLoadCard> {
  const rawCards = Array.isArray(plan?.load_pickings) ? plan.load_pickings : [];
  const rawPending = Array.isArray(plan?.pending_loads) ? plan.pending_loads : [];
  const rawRejected = Array.isArray(plan?.rejected_loads) ? plan.rejected_loads : [];
  const initialPickingId = inferInitialPickingId(plan, rawCards);
  const hasMultipleCards = rawCards.length > 1;
  const cardsById = new Map<number, RouteLoadCard>();

  for (const raw of rawCards) {
    const card = normalizeLoadCard(raw, initialPickingId, hasMultipleCards);
    if (card) cardsById.set(card.picking_id, card);
  }

  for (const raw of rawPending) {
    const card = normalizeLoadCard(raw, initialPickingId, hasMultipleCards);
    if (card) cardsById.set(card.picking_id, { ...cardsById.get(card.picking_id), ...card });
  }

  for (const raw of rawRejected) {
    const card = normalizeLoadCard(
      { ...raw, rejected: true, accepted: false },
      initialPickingId,
      hasMultipleCards,
    );
    if (card) {
      cardsById.set(card.picking_id, {
        ...cardsById.get(card.picking_id),
        ...card,
        rejected: true,
        accepted: false,
      });
    }
  }

  return cardsById;
}

export function buildRouteLoadAcceptanceState(plan: any): RouteLoadAcceptanceState {
  const rawPending = Array.isArray(plan?.pending_loads) ? plan.pending_loads : [];
  const rawCards = Array.isArray(plan?.load_pickings) ? plan.load_pickings : [];
  const initialPickingId = inferInitialPickingId(plan, rawCards);
  const hasMultipleCards = rawCards.length > 1;
  const cardsById = mergeLoadCards(plan);
  const loadCards = Array.from(cardsById.values());
  const pendingLoads = rawPending.length > 0
    ? rawPending
        .map((raw: unknown) => normalizeLoadCard(raw, initialPickingId, hasMultipleCards))
        .filter((card: RouteLoadCard | null): card is RouteLoadCard => !!card)
        .filter(isPendingLoadCard)
    : loadCards.filter(isPendingLoadCard);
  const acceptedLoads = loadCards.filter((card) => card.accepted === true);
  const rejectedLoads = loadCards.filter((card) => card.rejected === true);

  return {
    loadCards,
    pendingLoads,
    acceptedLoads,
    rejectedLoads,
    hasPendingLoad: pendingLoads.length > 0,
    nextPendingLoad: pendingLoads[0] || null,
  };
}

export function buildInitialLoadAcceptanceState(plan: unknown): InitialLoadAcceptanceState {
  const state = buildRouteLoadAcceptanceState(plan);
  const initialLoads = state.loadCards.filter((card) => !card.isRefill);
  const pendingInitialLoads = state.pendingLoads.filter((card) => !card.isRefill);
  const acceptedInitialLoads = initialLoads.filter((card) => card.accepted === true);
  const rejectedInitialLoads = initialLoads.filter((card) => card.rejected === true);

  // Fail closed: the start-of-day flow requires positive evidence that the
  // initial load exists and was accepted. An empty payload can mean that the
  // picking was not linked or did not reach the phone, so it must not be
  // interpreted as an automatic acceptance.
  const initialLoadAccepted = pendingInitialLoads.length === 0
    && acceptedInitialLoads.length > 0;
  const initialLoadRejectedWaiting = pendingInitialLoads.length === 0
    && acceptedInitialLoads.length === 0
    && rejectedInitialLoads.length > 0;

  return {
    initialLoads,
    pendingInitialLoads,
    rejectedInitialLoads,
    initialLoadAccepted,
    initialLoadRejectedWaiting,
    nextPendingInitialLoad: pendingInitialLoads[0] || null,
  };
}

export function canStartSaleWithRouteLoad(plan: any): boolean {
  return buildInitialLoadAcceptanceState(plan).initialLoadAccepted;
}
