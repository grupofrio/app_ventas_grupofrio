/**
 * F39 — gates that must pass before liquidación or route close.
 *
 * Production `liquidacion/confirm` auto-closes an in_progress plan. The app
 * therefore has to capture KM llegada and resolve in-progress stops BEFORE
 * that POST. Pending stops are not auto-visited; the seller must see them
 * and confirm.
 */

export interface CloseStopRef {
  id: number;
  customer_name?: string | null;
  route_sequence?: number | null;
  state?: string | null;
}

export interface OpenStopsForClose {
  pending: CloseStopRef[];
  inProgress: CloseStopRef[];
}

const CLOSED_PLAN_STATES = new Set(['closed', 'reconciled', 'done']);

function bySequence(a: CloseStopRef, b: CloseStopRef): number {
  const seqA = typeof a.route_sequence === 'number' ? a.route_sequence : Number.MAX_SAFE_INTEGER;
  const seqB = typeof b.route_sequence === 'number' ? b.route_sequence : Number.MAX_SAFE_INTEGER;
  if (seqA !== seqB) return seqA - seqB;
  return a.id - b.id;
}

export function partitionOpenStops(stops: readonly CloseStopRef[]): OpenStopsForClose {
  const pending: CloseStopRef[] = [];
  const inProgress: CloseStopRef[] = [];
  for (const stop of stops) {
    if (stop.state === 'pending') pending.push(stop);
    else if (stop.state === 'in_progress') inProgress.push(stop);
  }
  pending.sort(bySequence);
  inProgress.sort(bySequence);
  return { pending, inProgress };
}

export function formatCloseStopLine(stop: CloseStopRef): string {
  const name = (stop.customer_name ?? '').trim() || `Parada ${stop.id}`;
  if (typeof stop.route_sequence === 'number' && Number.isFinite(stop.route_sequence)) {
    return `${stop.route_sequence} · ${name}`;
  }
  return name;
}

function listLines(stops: readonly CloseStopRef[]): string {
  return stops.map((stop) => `• ${formatCloseStopLine(stop)}`).join('\n');
}

export interface OpenStopsConfirmation {
  title: string;
  message: string;
  /** In-progress visits must be checked out before the plan can close. */
  requiresCheckout: boolean;
  /** Pending and/or in-progress stops need an explicit confirmation. */
  requiresAcknowledgement: boolean;
}

export function describeOpenStopsConfirmation(open: OpenStopsForClose): OpenStopsConfirmation {
  const pendingCount = open.pending.length;
  const activeCount = open.inProgress.length;
  if (pendingCount === 0 && activeCount === 0) {
    return {
      title: '',
      message: '',
      requiresCheckout: false,
      requiresAcknowledgement: false,
    };
  }

  const parts: string[] = [];
  if (activeCount > 0) {
    parts.push(
      `En curso (${activeCount}). Se cierran en el servidor antes de liquidar, sin marcarlas como no-venta si ya hubo entrega:`,
    );
    parts.push(listLines(open.inProgress));
  }
  if (pendingCount > 0) {
    parts.push(`Pendientes (${pendingCount}). Siguen sin visitarse:`);
    parts.push(listLines(open.pending));
  }
  parts.push('Confirmar liquidación también cierra la ruta. Revisa la lista antes de continuar.');

  const title = activeCount > 0
    ? `Hay ${activeCount} visita(s) en curso y ${pendingCount} pendiente(s)`
    : `Hay ${pendingCount} parada(s) pendiente(s)`;

  return {
    title,
    message: parts.join('\n\n'),
    requiresCheckout: activeCount > 0,
    requiresAcknowledgement: true,
  };
}

export type ArrivalKmResult =
  | { ok: true; arrival: number }
  | { ok: false; arrival: null; message: string };

function parseKm(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseFloat(value.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

/**
 * KM llegada must be a positive odometer and cannot be below KM salida.
 * A missing departure does not invent one; llegada still has to be > 0.
 */
export function validateArrivalKm(input: {
  arrival: unknown;
  departure?: number | null;
}): ArrivalKmResult {
  const arrival = parseKm(input.arrival);
  if (arrival == null || arrival <= 0) {
    return {
      ok: false,
      arrival: null,
      message: 'Captura el KM de llegada (mayor a 0) antes de cerrar.',
    };
  }
  const departure = parseKm(input.departure);
  if (departure != null && departure > 0 && arrival < departure) {
    return {
      ok: false,
      arrival: null,
      message: `El KM de llegada (${arrival.toLocaleString('es-MX')}) no puede ser menor al de salida (${departure.toLocaleString('es-MX')}).`,
    };
  }
  return { ok: true, arrival };
}

export function planIsClosedState(state: string | null | undefined): boolean {
  return typeof state === 'string' && CLOSED_PLAN_STATES.has(state);
}

/**
 * The finished screen hides the KM field. Show it only when the plan is
 * closed AND llegada was actually stored (>= salida when salida exists).
 * A close with arrival_km 0 must keep the capture form visible.
 */
export function routeCloseShowsFinished(input: {
  planState?: string | null;
  localClosed?: boolean;
  arrivalKm?: unknown;
  departureKm?: number | null;
}): boolean {
  const closed = input.localClosed === true || planIsClosedState(input.planState);
  if (!closed) return false;
  return validateArrivalKm({
    arrival: input.arrivalKm,
    departure: input.departureKm,
  }).ok;
}
