/**
 * Read-only invoice collection presentation state for one planned visit.
 *
 * This accepts an already-validated day bundle for orientation only. It does
 * not decide whether a stale bundle may authorize a mutation; callers must
 * apply the current day-bundle action gate when they submit a collection.
 */

import type { DayBundle, OpenInvoiceSnapshot } from './employeeDayBundleLogic.ts';
import type { InvoiceCollectionIntent } from './invoiceCollection.ts';

export type VisitInvoiceCollectionState = 'ready' | 'pending' | 'review_required' | 'requires_refresh';

export interface VisitCollectionInvoice {
  readonly invoice: Readonly<OpenInvoiceSnapshot>;
  readonly collection_state: VisitInvoiceCollectionState;
  readonly intent: Readonly<Pick<InvoiceCollectionIntent, 'operation_id' | 'status'>> | null;
}

export interface VisitCollectionState {
  readonly stop_id: number;
  readonly customer_name: string | null;
  readonly snapshot_as_of: string | null;
  readonly invoices: readonly VisitCollectionInvoice[];
}

function matchingStop(bundle: DayBundle, stopId: number): Record<string, unknown> {
  const stop = bundle.stops.find((candidate) => typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
    && (candidate as { id?: unknown }).id === stopId);
  if (!stop) throw new Error('El stop no existe en el bundle validado.');
  return stop as Record<string, unknown>;
}

function customerName(stop: Record<string, unknown>): string | null {
  const customer = stop.customer;
  if (typeof customer !== 'object' || customer === null || Array.isArray(customer)) return null;
  const name = (customer as Record<string, unknown>).name;
  return typeof name === 'string' && name.trim() ? name : null;
}

function snapshotAsOfMs(value: string | null): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})Z?$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const parsed = new Date(ms);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== hour || parsed.getUTCMinutes() !== minute || parsed.getUTCSeconds() !== second) {
    return null;
  }
  return ms;
}

function appliedIntentRequiringRefresh(
  intents: readonly InvoiceCollectionIntent[],
  snapshotAsOf: string | null,
): InvoiceCollectionIntent | undefined {
  const applied = intents.filter((intent) => intent.status === 'applied');
  if (applied.length === 0) return undefined;
  const current = snapshotAsOfMs(snapshotAsOf);
  const appliedWithTimes = applied.map((intent) => ({ intent, at: snapshotAsOfMs(intent.snapshot_as_of) }));
  if (current === null || appliedWithTimes.some(({ at }) => at === null)) return applied[0];
  const latest = Math.max(...appliedWithTimes.map(({ at }) => at as number));
  if (current > latest) return undefined;
  return appliedWithTimes.find(({ at }) => at === latest)?.intent;
}

function matchingIntent(
  intents: readonly InvoiceCollectionIntent[],
  stopId: number,
  invoiceId: number,
  snapshotAsOf: string | null,
): InvoiceCollectionIntent | undefined {
  const matching = intents.filter((intent) => intent.stop_id === stopId && intent.invoice_id === invoiceId);
  const active = matching.filter((intent) => intent.status !== 'applied');
  if (active.length > 1) throw new Error('Hay múltiples intents activos para la misma factura.');
  if (active[0]) return active[0];
  // Only a parseable snapshot later than every applied intent may unlock a
  // new capture. A different spelling, an older timestamp, or absent metadata
  // cannot demonstrate freshness and therefore remains safely locked.
  return appliedIntentRequiringRefresh(matching, snapshotAsOf);
}

/** Guards UI publication for overlapping loads and unmounted visit screens. */
export function createVisitCollectionLifecycle() {
  let generation = 0;
  let active = true;
  return {
    beginLoad(): number {
      generation += 1;
      return generation;
    },
    canPublishLoad(requestGeneration: number): boolean {
      return active && requestGeneration === generation;
    },
    isActive(): boolean {
      return active;
    },
    dispose(): void {
      active = false;
    },
  };
}

function invoiceState(intent: InvoiceCollectionIntent | undefined): VisitInvoiceCollectionState {
  if (!intent) return 'ready';
  if (intent.status === 'applied') return 'requires_refresh';
  if (intent.status === 'review_required') return 'review_required';
  return 'pending';
}

function copyInvoice(invoice: OpenInvoiceSnapshot): Readonly<OpenInvoiceSnapshot> {
  return {
    invoice_id: invoice.invoice_id,
    name: invoice.name,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    currency: invoice.currency,
    amount_residual: invoice.amount_residual,
  };
}

/**
 * Produces display state for exactly one snapshot belonging to a planned
 * stop. It never mutates the bundle or an intent.
 */
export function buildVisitCollectionState(
  bundle: DayBundle,
  stopId: number,
  intents: readonly InvoiceCollectionIntent[],
): VisitCollectionState {
  const stop = matchingStop(bundle, stopId);

  const snapshots = (bundle.invoice_snapshots ?? []).filter((snapshot) => snapshot.stop_id === stopId);
  if (snapshots.length !== 1) {
    throw new Error('Se requiere exactamente un snapshot de facturas para el stop.');
  }

  const snapshot = snapshots[0];
  const invoiceIds = new Set<number>();
  const invoices = snapshot.invoices.map((invoice) => {
    if (invoiceIds.has(invoice.invoice_id)) {
      throw new Error('invoice_id duplicado dentro del snapshot seleccionado.');
    }
    invoiceIds.add(invoice.invoice_id);
    const intent = matchingIntent(intents, stopId, invoice.invoice_id, snapshot.as_of);
    return {
      invoice: copyInvoice(invoice),
      collection_state: invoiceState(intent),
      intent: intent ? { operation_id: intent.operation_id, status: intent.status } : null,
    };
  });

  return { stop_id: stopId, customer_name: customerName(stop), snapshot_as_of: snapshot.as_of, invoices };
}

/** Validates a user-entered amount against one projected snapshot invoice. */
export function assertVisitCollectionAmount(
  invoice: Pick<OpenInvoiceSnapshot, 'amount_residual'>,
  amount: unknown,
): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('El monto debe ser un número finito mayor que cero.');
  }
  if (!Number.isFinite(invoice.amount_residual) || invoice.amount_residual <= 0) {
    throw new Error('El saldo del snapshot no es válido.');
  }
  if (amount > invoice.amount_residual) {
    throw new Error('El monto excede el saldo del snapshot.');
  }
  return amount;
}
