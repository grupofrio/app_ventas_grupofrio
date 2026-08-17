/**
 * Collect payment UX copy — RN-free.
 * Enqueue ≠ server-registered; never claim method confirmation from chips alone.
 */

export type CollectPaymentUiOutcome =
  | { status: 'enqueued'; operationId: string }
  | { status: 'ignored_inflight' }
  | { status: 'ignored_done' };

export function describeCollectPaymentAlert(input: {
  outcome: CollectPaymentUiOutcome;
  amountLabel: string;
}): { title: string; body: string } | null {
  if (input.outcome.status === 'ignored_inflight') {
    return {
      title: 'Cobro en proceso',
      body: 'Ya hay un cobro enviándose. Espera un momento; no pulses de nuevo.',
    };
  }
  if (input.outcome.status === 'ignored_done') {
    return {
      title: 'Cobro ya en cola',
      body: 'Este cobro ya quedó pendiente de sincronización. Revisa Sync si no aparece confirmado.',
    };
  }
  // enqueued — durable queue only; server ACK happens later via Sync.
  return {
    title: 'Cobro pendiente de sincronizar',
    body:
      `${input.amountLabel} quedó en cola (operation ${input.outcome.operationId.slice(0, 8)}…). ` +
      'Aún no está confirmado en Odoo. No lo vuelvas a registrar.',
  };
}
