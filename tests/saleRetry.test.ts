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
  isRetryableProtectedSaleOrder: (item: unknown) => boolean;
  createSaleOrderRetryAction: (dependencies: {
    read: () => { queue: SyncQueueItem[]; isOnline: boolean };
    persistAndPublish: (transform: (queue: SyncQueueItem[]) => SyncQueueItem[]) => Promise<void>;
    processQueue: () => Promise<void>;
  }) => (operationId: string) => Promise<void>;
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
    error_code: partial.error_code ?? null,
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
      error_code: 'insufficient_stock',
    }),
  ];
  const out = m.rearmSaleOrderForRetry(queue, 'sale-1');
  assert.equal(out[0].status, 'pending');
  assert.equal(out[0].retries, 0);
  assert.equal(out[0].next_retry_at, null);
  assert.equal(out[0].error_message, null);
  assert.equal(out[0].error_code, null);
  // Identity preserved on every other field.
  assert.equal(out[0].id, 'sale-1');
  assert.equal(out[0].type, 'sale_order');
  assert.equal(out[0].priority, 1);
}

function testPreservesExactSaleDataWithoutMutation(m: SaleRetryModule) {
  const payload = { lines: [{ product_id: 7, quantity: 2 }] };
  const meta: NonNullable<SyncQueueItem['meta']> = {
    x_client_event_at: '2026-07-25T10:00:00.000Z',
    x_client_event_tz: 'America/Mexico_City',
    x_client_op_uuid: 'Sale-Exact',
    x_client_device_id: 'device-test',
    x_client_schema: 'client-meta-1',
  };
  const queue = [makeItem({
    id: 'Sale-Exact',
    type: 'sale_order',
    status: 'dead',
    payload,
    meta,
    error_code: 'insufficient_stock',
    error_message: 'stock insuficiente',
  })];
  const before = structuredClone(queue);

  const out = m.rearmSaleOrderForRetry(queue, 'Sale-Exact');

  assert.equal(out.length, 1, 'no duplica operaciones');
  assert.equal(out[0].id, 'Sale-Exact', 'conserva el operation_id exacto');
  assert.equal(out[0].payload, payload, 'conserva payload exacto');
  assert.equal(out[0].meta, meta, 'conserva contexto exacto');
  assert.deepEqual(queue, before, 'no muta la entrada');
}

async function testRetryActionPersistsBeforePublishingAndProcessing(m: SaleRetryModule) {
  let state = {
    isOnline: true,
    queue: [makeItem({
      id: 'sale-stock', type: 'sale_order', status: 'dead',
      error_code: 'insufficient_stock', error_message: 'stock insuficiente',
    })],
  };
  const events: string[] = [];
  const retry = m.createSaleOrderRetryAction({
    read: () => state,
    persistAndPublish: async (transform) => {
      const next = transform(state.queue);
      events.push(`persist:${next[0].status}:${next[0].error_code}`);
      state = { ...state, queue: next };
      events.push('publish');
    },
    processQueue: async () => {
      events.push(`process:${state.queue[0].status}`);
    },
  });

  await retry('sale-stock');

  assert.deepEqual(events, [
    'persist:pending:null',
    'publish',
    'process:pending',
  ]);
}

async function testRetryActionRejectsInvalidTargets(m: SaleRetryModule) {
  const protectedSale = makeItem({
    id: 'sale-stock', type: 'sale_order', status: 'dead', error_code: 'insufficient_stock',
  });
  let state = { isOnline: false, queue: [protectedSale] };
  let persisted = 0;
  let processed = 0;
  const retry = m.createSaleOrderRetryAction({
    read: () => state,
    persistAndPublish: async () => { persisted += 1; },
    processQueue: async () => { processed += 1; },
  });

  await assert.rejects(retry('sale-stock'), /conexi[oó]n|online/i);
  state = { ...state, isOnline: true };
  await assert.rejects(retry(' sale-stock '), /identificador|operation/i);
  await assert.rejects(retry('missing'), /protegida|stock/i);
  state = {
    ...state,
    queue: [makeItem({ id: 'ordinary', type: 'sale_order', status: 'dead' })],
  };
  await assert.rejects(retry('ordinary'), /protegida|stock/i);
  assert.equal(persisted, 0);
  assert.equal(processed, 0);
}

async function testRetryActionKeepsPriorStateWhenPersistenceFails(m: SaleRetryModule) {
  const original = makeItem({
    id: 'sale-stock', type: 'sale_order', status: 'dead',
    error_code: 'insufficient_stock', error_message: 'stock insuficiente',
  });
  const state = { isOnline: true, queue: [original] };
  let processed = 0;
  const retry = m.createSaleOrderRetryAction({
    read: () => state,
    persistAndPublish: async () => { throw new Error('storage unavailable'); },
    processQueue: async () => { processed += 1; },
  });

  await assert.rejects(retry('sale-stock'), /storage unavailable/);
  assert.equal(state.queue[0], original, 'el estado protegido previo sigue publicado');
  assert.equal(state.queue[0].error_code, 'insufficient_stock');
  assert.equal(processed, 0, 'no procesa si no pudo persistir el rearmado');
}

async function testRetryActionKeepsRearmedSaleVisibleWhenProcessingFails(m: SaleRetryModule) {
  let state = {
    isOnline: true,
    queue: [makeItem({
      id: 'sale-stock', type: 'sale_order', status: 'dead',
      error_code: 'insufficient_stock', error_message: 'stock insuficiente',
    })],
  };
  const retry = m.createSaleOrderRetryAction({
    read: () => state,
    persistAndPublish: async (transform) => {
      state = { ...state, queue: transform(state.queue) };
    },
    processQueue: async () => { throw new Error('processor failed'); },
  });

  await assert.rejects(retry('sale-stock'), /processor failed/);
  assert.equal(state.queue[0].status, 'pending');
  assert.equal(state.queue[0].id, 'sale-stock');
  assert.equal(state.queue.length, 1, 'el fallo de proceso no oculta ni duplica la venta');
}

function testRetryEligibilityUsesDurableCodeAndActionableStatuses(m: SaleRetryModule) {
  for (const status of ['pending', 'error', 'dead'] as const) {
    assert.equal(m.isRetryableProtectedSaleOrder(makeItem({
      id: `sale-${status}`,
      type: 'sale_order',
      status,
      error_code: ' insufficient_STOCK ',
    })), true, status);
  }
  for (const status of ['syncing', 'done'] as const) {
    assert.equal(m.isRetryableProtectedSaleOrder(makeItem({
      id: `sale-${status}`,
      type: 'sale_order',
      status,
      error_code: 'insufficient_stock',
    })), false, status);
  }
  assert.equal(m.isRetryableProtectedSaleOrder(null), false);
}

async function testRetryActionCoalescesSameId(m: SaleRetryModule) {
  let state = {
    isOnline: true,
    queue: [makeItem({
      id: 'sale-stock', type: 'sale_order', status: 'dead', error_code: 'insufficient_stock',
    })],
  };
  let releasePersist!: () => void;
  const persistenceGate = new Promise<void>((resolve) => { releasePersist = resolve; });
  let persists = 0;
  let processes = 0;
  const retry = m.createSaleOrderRetryAction({
    read: () => state,
    persistAndPublish: async (transform) => {
      persists += 1;
      await persistenceGate;
      state = { ...state, queue: transform(state.queue) };
    },
    processQueue: async () => { processes += 1; },
  });

  const first = retry('sale-stock');
  const second = retry('sale-stock');
  assert.equal(second, first, 'doble tap comparte el mismo vuelo');
  releasePersist();
  await Promise.all([first, second]);
  assert.equal(persists, 1);
  assert.equal(processes, 1);
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

function testDoesNotRearmCollidingNonSaleItem(m: SaleRetryModule) {
  const queue: SyncQueueItem[] = [
    makeItem({
      id: 'shared-id', type: 'sale_order', status: 'dead',
      error_code: 'insufficient_stock',
    }),
    makeItem({ id: 'shared-id', type: 'payment', status: 'error' }),
  ];

  const out = m.rearmSaleOrderForRetry(queue, 'shared-id');

  assert.equal(out[0].status, 'pending');
  assert.equal(out[1], queue[1], 'una colisión defensiva no rearma otro tipo');
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
  testPreservesExactSaleDataWithoutMutation(mod);
  testRearmsDeadSaleOrder(mod);
  testIgnoresMismatchedId(mod);
  testIgnoresWrongType(mod);
  testDoesNotRearmCollidingNonSaleItem(mod);
  testIgnoresAlreadyDoneOrPending(mod);
  testReturnsQueueUntouchedForEmptyId(mod);
  testRearmsDeadDependentPhotos(mod);
  testIgnoresDependentOfAnotherSale(mod);
  testDoesNotTouchLiveDependent(mod);
  await testRetryActionPersistsBeforePublishingAndProcessing(mod);
  await testRetryActionRejectsInvalidTargets(mod);
  await testRetryActionKeepsPriorStateWhenPersistenceFails(mod);
  await testRetryActionKeepsRearmedSaleVisibleWhenProcessingFails(mod);
  testRetryEligibilityUsesDurableCodeAndActionableStatuses(mod);
  await testRetryActionCoalescesSameId(mod);

  console.log('sale retry tests: ok');
}

void main();
