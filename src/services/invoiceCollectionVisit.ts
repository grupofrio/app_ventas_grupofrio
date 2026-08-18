/**
 * Read-only invoice collection presentation state for one planned visit.
 *
 * This accepts an already-validated day bundle for orientation only. It does
 * not decide whether a stale bundle may authorize a mutation; callers must
 * apply the current day-bundle action gate when they submit a collection.
 */

import type { DayBundle, OpenInvoiceSnapshot } from './employeeDayBundleLogic.ts';
import type { InvoiceCollectionIntent } from './invoiceCollection.ts';

export type VisitInvoiceCollectionState = 'ready' | 'pending' | 'review_required';

export interface VisitCollectionInvoice {
  readonly invoice: Readonly<OpenInvoiceSnapshot>;
  readonly collection_state: VisitInvoiceCollectionState;
  readonly intent: Readonly<Pick<InvoiceCollectionIntent, 'operation_id' | 'status'>> | null;
}

export interface VisitCollectionState {
  readonly stop_id: number;
  readonly snapshot_as_of: string | null;
  readonly invoices: readonly VisitCollectionInvoice[];
}

function hasStopId(stop: unknown, stopId: number): boolean {
  return typeof stop === 'object' && stop !== null && !Array.isArray(stop)
    && (stop as { id?: unknown }).id === stopId;
}

function matchingIntent(
  intents: readonly InvoiceCollectionIntent[],
  stopId: number,
  invoiceId: number,
): InvoiceCollectionIntent | undefined {
  const active = intents.filter((intent) => intent.stop_id === stopId && intent.invoice_id === invoiceId
    && intent.status !== 'applied');
  if (active.length > 1) throw new Error('Hay múltiples intents activos para la misma factura.');
  return active[0];
}

function invoiceState(intent: InvoiceCollectionIntent | undefined): VisitInvoiceCollectionState {
  if (!intent) return 'ready';
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
  if (!bundle.stops.some((stop) => hasStopId(stop, stopId))) {
    throw new Error('El stop no existe en el bundle validado.');
  }

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
    const intent = matchingIntent(intents, stopId, invoice.invoice_id);
    return {
      invoice: copyInvoice(invoice),
      collection_state: invoiceState(intent),
      intent: intent ? { operation_id: intent.operation_id, status: intent.status } : null,
    };
  });

  return { stop_id: stopId, snapshot_as_of: snapshot.as_of, invoices };
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
