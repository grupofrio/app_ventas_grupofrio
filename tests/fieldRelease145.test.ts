import assert from 'node:assert/strict';
import test from 'node:test';

import { recognizeGift } from '../src/services/giftRecognition.ts';
import { findDuplicateGift } from '../src/services/giftDuplicate.ts';
import { corteAdjustmentTitle, formatCorteFailureMessage } from '../src/services/corteFeedback.ts';
import { formatSyncedOperations } from '../src/services/syncProgressLabel.ts';
import { decideCameraPermission, CAMERA_OPEN_ERROR } from '../src/services/cameraAccess.ts';
import { isChecklistRatingV2 } from '../src/services/checklistRating.ts';
import { mergeMermaCatalog } from '../src/services/mermaCatalog.ts';
import { formatMexicoClock } from '../src/utils/localDate.ts';
import { readPositiveStopId, rememberStopRemap, resolveStopId, clearStopRemapsForTests } from '../src/services/stopIdRemap.ts';
import { buildExchangeTicketSnapshot, exchangeTicketStatusCopy } from '../src/services/exchangeTicket.ts';

test('pending exchange copy does not say the change was registered', () => {
  const copy = exchangeTicketStatusCopy('pending');
  assert.equal(copy.statusLabel, 'PENDIENTE DE SINCRONIZACIÓN');
  assert.equal(copy.footerMessage, 'Cambio pendiente; no repetir la operación');
  assert.doesNotMatch(copy.footerMessage, /registrado correctamente/);
});

test('exchange snapshot keeps the seller for reprints', () => {
  const snapshot = buildExchangeTicketSnapshot({
    snapshotId: 'abc',
    exchangeName: 'CAM/2026/00004',
    exchangeId: 4,
    customerName: 'Liceo',
    createdAt: '2026-10-08T20:00:00.000Z',
    deliveryLines: [{ productId: 1, qty: 1 }],
    mermaLines: [],
    sellerName: 'Alvaro Garcia',
    unitLabel: 'U-302',
    stopLabel: '3 · Liceo',
  });
  assert.equal(snapshot.sellerName, 'Alvaro Garcia');
  assert.equal(snapshot.unitLabel, 'U-302');
  assert.equal(snapshot.stopLabel, '3 · Liceo');
});

test('gift recognition uses the server flag and does not guess from a zero total', () => {
  assert.equal(recognizeGift({ is_gift: true, amount_total: 36 } as never), true);
  assert.equal(recognizeGift({ is_gift: false }), false);
  assert.equal(recognizeGift({ client_order_ref: 'GIFT:abc' }), true);
  assert.equal(recognizeGift({ origin: 'REGALO ruta' }), true);
  assert.equal(recognizeGift({ lines: [{ discount: 100, price_subtotal: 0 }] }), true);
  assert.equal(recognizeGift({ amount_total: 0 } as never), false);
});

test('duplicate gift matches the same client and product on the Mexico day', () => {
  const now = Date.parse('2026-10-09T18:00:00Z');
  assert.equal(findDuplicateGift({
    partnerId: 10,
    productIds: [7],
    nowMs: now,
    existing: [{ partnerId: 10, productIds: [7], createdAtMs: Date.parse('2026-10-09T15:00:00Z') }],
  }), true);
  assert.equal(findDuplicateGift({
    partnerId: 10,
    productIds: [8],
    nowMs: now,
    existing: [{ partnerId: 10, productIds: [7], createdAtMs: Date.parse('2026-10-09T15:00:00Z') }],
  }), false);
});

test('corte feedback shows server lines and does not claim quantities were saved', () => {
  assert.equal(
    formatCorteFailureMessage({
      message: 'El corte no cuadra',
      details: { errors: ['KOLD-5 diferencia 2'] },
    }, 'fallback'),
    'El corte no cuadra\nKOLD-5 diferencia 2',
  );
  assert.equal(corteAdjustmentTitle({
    message: 'El corte se calcula automáticamente; no se guardaron cantidades manuales.',
  }), 'No se guardaron cantidades');
  assert.equal(corteAdjustmentTitle({ message: 'Devolución guardada' }), 'Ajustes guardados');
});

test('sync progress excludes dead items from the synced numerator', () => {
  assert.equal(formatSyncedOperations({ totalItems: 22, pendingCount: 0, deadCount: 2 }), '20/22');
});

test('camera opens only after a granted permission and names the timeout', () => {
  assert.equal(decideCameraPermission('granted'), 'open');
  assert.equal(decideCameraPermission('undetermined'), 'request');
  assert.equal(CAMERA_OPEN_ERROR, 'No se pudo abrir la cámara');
});

test('checklist v2 stays off unless the server turns it on', () => {
  assert.equal(isChecklistRatingV2({}), false);
  assert.equal(isChecklistRatingV2({ vehicle_checklist_rating_v2: false }), false);
  assert.equal(isChecklistRatingV2({ vehicle_checklist_rating_v2: true }), true);
  assert.equal(isChecklistRatingV2({ checklist_rating_mode: 'v2' }), true);
});

test('merma catalog includes products the van does not stock', () => {
  const merged = mergeMermaCatalog<{ id: number; name?: string; default_code?: string }>(
    [{ id: 1 }],
    [{ id: 1, name: 'En van' }, { id: 2, name: 'Solo cliente', default_code: 'K5' }],
    (item) => item,
  );
  assert.deepEqual(merged, [{ id: 1 }, { id: 2, name: 'Solo cliente', default_code: 'K5' }]);
});

test('Mexico clock uses fixed UTC-6 for current instants', () => {
  assert.equal(formatMexicoClock('2026-10-09T08:16:00Z'), '02:16');
});

test('stop remap reads a positive server id and remembers the virtual one', () => {
  clearStopRemapsForTests();
  assert.equal(readPositiveStopId({ data: { gf_route_stop_id: 1044 } }), 1044);
  assert.equal(readPositiveStopId({ stop_id: -3 }), null);
  rememberStopRemap(-3, 1044);
  assert.equal(resolveStopId(-3), 1044);
  clearStopRemapsForTests();
});
