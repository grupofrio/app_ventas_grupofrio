/**
 * Tests for rearmSaleOrderForRetry — the pure helper that drives the
 * "Reintentar sincronización" button on the Check-out screen when a
 * sale_order ended up failed/dead because Odoo rejected it (e.g. the
 * "configure la dirección de correo electrónico del remitente" 500
 * reported on 2026-05-06).
 *
 * The button must:
 *   - flip the failed item back to pending,
 *   - reset retries so MAX_RETRIES doesn't gate the next cycle,
 *   - clear next_retry_at so backoff doesn't postpone the retry,
 *   - clear error_message so the UI banner disappears,
 *   - touch ONLY the matching item (no cross-contamination).
 */

import assert from 'node:assert/strict';
import type { SyncQueueItem } from '../src/types/sync';

interface SaleRetryModule {
  rearmSaleOrderForRetry: (queue: SyncQueueItem[], saleOperationId: string) => SyncQueueItem[];
}

function makeItem(partial: Partial<SyncQueueItem> & Pick<SyncQueueItem, 'id' | 'type' | 'status'>): SyncQueueItem {
  return {
    id: partial.id,
    type: partial.type,
    payload: partial.payload ?? {},
    status: partial.status,
    created_at: partial.created_at ?? 1_000_000,
    retries: partial.retries ?? 0,
    error_message: partial.error_message ?? null,
    priority: partial.priority ?? 1,
    next_retry_at: partial.next_retry_at ?? null,
    dependsOn: partial.dependsOn,
    meta: partial.meta,
  };
}

function testRearmsFailedSaleOrder(m: SaleRetryModule) {
  const queue: SyncQueueItem[] = [
    makeItem({
      id: 'sale-1', type: 'sale_order', status: 'error',
      retries: 3, next_retry_at: 9_999_999,
      error_message: 'No se puede enviar el mensaje, configure la dirección de correo electrónico del remitente.',
    }),
  ];
  const out = m.rearmSaleOrderForRetry(queue, 'sale-1');
  assert.equal(out[0].status, 'pending');
  assert.equal(out[0].retries, 0);
  assert.equal(out[0].next_retry_at, null);
  assert.equal(out[0].error_message, null);
  // Identity preserved on every other field.
  assert.equal(out[0].id, 'sale-1');
  assert.equal(out[0].type, 'sale_order');
  assert.equal(out[0].priority, 1);
}

function testRearmsDeadSaleOrder(m: SaleRetryModule) {
  // After MAX_RETRIES the item moves to 'dead'. The retry button must
  // recover from that state too — otherwise a vendor stuck in 'dead'
  // can never close the visit even after backend is fixed.
  const queue: SyncQueueItem[] = [
    makeItem({ id: 'sale-1', type: 'sale_order', status: 'dead', retries: 3 }),
  ];
  const out = m.rearmSaleOrderForRetry(queue, 'sale-1');
  assert.equal(out[0].status, 'pending');
}

function testIgnoresMismatchedId(m: SaleRetryModule) {
  const queue: SyncQueueItem[] = [
    makeItem({ id: 'sale-1', type: 'sale_order', status: 'error' }),
    makeItem({ id: 'sale-2', type: 'sale_order', status: 'error' }),
  ];
  const out = m.rearmSaleOrderForRetry(queue, 'sale-2');
  assert.equal(out[0].status, 'error', 'sale-1 must not be touched');
  assert.equal(out[1].status, 'pending');
}

function testIgnoresWrongType(m: SaleRetryModule) {
  // Defensive: never rearm a non-sale_order item even if id matches by
  // collision — operation_id is supposed to be unique but this is the
  // last line of defense.
  const queue: SyncQueueItem[] = [
    makeItem({ id: 'op-1', type: 'payment', status: 'error' }),
  ];
  const out = m.rearmSaleOrderForRetry(queue, 'op-1');
  assert.equal(out[0].status, 'error');
}

function testIgnoresAlreadyDoneOrPending(m: SaleRetryModule) {
  const queue: SyncQueueItem[] = [
    makeItem({ id: 'sale-done', type: 'sale_order', status: 'done' }),
    makeItem({ id: 'sale-pending', type: 'sale_order', status: 'pending' }),
    makeItem({ id: 'sale-syncing', type: 'sale_order', status: 'syncing' }),
  ];
  for (const target of ['sale-done', 'sale-pending', 'sale-syncing']) {
    const out = m.rearmSaleOrderForRetry(queue, target);
    assert.deepEqual(out, queue, `must not modify ${target}`);
  }
}

function testReturnsQueueUntouchedForEmptyId(m: SaleRetryModule) {
  const queue: SyncQueueItem[] = [
    makeItem({ id: 'sale-1', type: 'sale_order', status: 'error' }),
  ];
  assert.equal(m.rearmSaleOrderForRetry(queue, ''), queue);
}

// BLD-20260617-DEAD-CASCADE: al reintentar la venta, sus fotos (que murieron
// en cascada cuando la venta murió) deben volver a 'pending' para que se suban
// tras el éxito de la venta. La dependencia (dependsOn) se conserva.
function testRearmsDeadDependentPhotos(m: SaleRetryModule) {
  const queue: SyncQueueItem[] = [
    makeItem({ id: 'sale-1', type: 'sale_order', status: 'dead', retries: 3 }),
    makeItem({
      id: 'photo-1', type: 'photo', status: 'dead', priority: 2,
      dependsOn: ['sale-1'], error_message: 'Foto no enviada porque la venta falló',
      next_retry_at: 9_999_999,
    }),
  ];
  const out = m.rearmSaleOrderForRetry(queue, 'sale-1');
  assert.equal(out.length, queue.length, 'no duplica items');
  assert.equal(out[0].status, 'pending', 'venta rearmada');
  assert.equal(out[1].status, 'pending', 'foto dependiente rearmada');
  assert.equal(out[1].error_message, null, 'mensaje de la foto limpiado');
  assert.equal(out[1].next_retry_at, null);
  assert.deepEqual(out[1].dependsOn, ['sale-1'], 'dependsOn preservado (sigue esperando la venta)');
}

function testIgnoresDependentOfAnotherSale(m: SaleRetryModule) {
  const queue: SyncQueueItem[] = [
    makeItem({ id: 'sale-1', type: 'sale_order', status: 'dead' }),
    makeItem({ id: 'photo-2', type: 'photo', status: 'dead', dependsOn: ['sale-2'] }),
  ];
  const out = m.rearmSaleOrderForRetry(queue, 'sale-1');
  assert.equal(out[1].status, 'dead', 'foto de otra venta no se toca');
}

function testDoesNotTouchLiveDependent(m: SaleRetryModule) {
  // Una foto aún 'pending' (la venta murió pero la cascada no aplicó, o venta en
  // 'error' no-dead) no necesita rearm; solo se rearman dependientes 'dead'.
  const queue: SyncQueueItem[] = [
    makeItem({ id: 'sale-1', type: 'sale_order', status: 'error' }),
    makeItem({ id: 'photo-1', type: 'photo', status: 'pending', dependsOn: ['sale-1'] }),
  ];
  const out = m.rearmSaleOrderForRetry(queue, 'sale-1');
  assert.equal(out[0].status, 'pending', 'venta rearmada');
  assert.equal(out[1].status, 'pending', 'foto pending sigue pending (sin cambio de estado)');
  assert.equal(out[1], queue[1], 'foto pending devuelta por referencia (intacta)');
}

async function main() {
  const mod = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/saleRetry.ts', import.meta.url).pathname
  ) as SaleRetryModule;

  testRearmsFailedSaleOrder(mod);
  testRearmsDeadSaleOrder(mod);
  testIgnoresMismatchedId(mod);
  testIgnoresWrongType(mod);
  testIgnoresAlreadyDoneOrPending(mod);
  testReturnsQueueUntouchedForEmptyId(mod);
  testRearmsDeadDependentPhotos(mod);
  testIgnoresDependentOfAnotherSale(mod);
  testDoesNotTouchLiveDependent(mod);

  console.log('sale retry tests: ok');
}

void main();
