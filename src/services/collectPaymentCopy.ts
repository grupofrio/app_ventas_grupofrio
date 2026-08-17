/**
 * Collect payment UX copy — RN-free.
 * Enqueue ≠ server-registered; never claim method confirmation from chips alone.
 * operation_id stays internal (idempotency); never surface it to the seller here.
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
      body: 'Ya estamos procesando este cobro. Espera un momento; no pulses de nuevo.',
    };
  }
  if (input.outcome.status === 'ignored_done') {
    return {
      title: 'Cobro ya guardado',
      body:
        'Este cobro ya quedó en el dispositivo pendiente de sincronizar. ' +
        'Revisa Sync si aún no aparece confirmado en Odoo. No es éxito de servidor todavía.',
    };
  }
  // enqueued — durable local queue only; server ACK happens later via Sync.
  return {
    title: 'Cobro pendiente de sincronizar',
    body:
      `${input.amountLabel} guardado en el dispositivo. ` +
      'Queda pendiente de sincronizar con Odoo. No es necesario capturarlo nuevamente.',
  };
}
