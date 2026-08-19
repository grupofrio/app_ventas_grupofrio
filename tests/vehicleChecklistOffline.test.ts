import assert from 'node:assert/strict';

async function main() {
  // @ts-ignore -- Node 24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/vehicleChecklistOffline.ts', import.meta.url).pathname
  );

  const {
    collectQueuedChecklistAnswerOps,
    collectDeadChecklistAnswerCheckIds,
    collectDeadChecklistAnswerOpIds,
    hasQueuedChecklistComplete,
    hasQueuedChecklistCompleteForPlan,
    buildVehicleCheckQueuePayload,
    applyLocalCheckAnswer,
    areRequiredChecksAnswered,
    checklistDraftsStorageKey,
    checklistSnapshotStorageKey,
  } = module;

  assert.equal(checklistDraftsStorageKey(7), 'route:checklistDrafts:7');
  assert.equal(checklistSnapshotStorageKey(7), 'route:checklistSnapshot:7');

  // ── buildVehicleCheckQueuePayload ─────────────────────────────────────────
  const boolPayload = buildVehicleCheckQueuePayload({
    check: { id: 11, check_type: 'yes_no' },
    checklistId: 3,
    planId: 7,
    answer: { result_bool: false, not_passed_reason: 'llanta baja' },
  });
  assert.deepEqual(boolPayload, {
    check_id: 11,
    checklist_id: 3,
    plan_id: 7,
    answer: { result_bool: false, not_passed_reason: 'llanta baja' },
  });

  // Foto: guarda URI, PODA cualquier base64 del answer (la cola nunca
  // serializa megabytes) y arma filename.
  const photoPayload = buildVehicleCheckQueuePayload({
    check: { id: 12, check_type: 'photo' },
    checklistId: 3,
    planId: 7,
    answer: { result_photo: 'BASE64GIGANTE', result_photo_filename: 'x.jpg' },
    photoUri: 'file:///photos/odo.jpg',
  });
  assert.equal(photoPayload.photo_uri, 'file:///photos/odo.jpg');
  assert.equal((photoPayload.answer as Record<string, unknown>).result_photo, undefined);
  assert.match(photoPayload.photo_filename ?? '', /^odometro_12_\d+\.jpg$/);

  // ── applyLocalCheckAnswer: mismas reglas de passed que el backend ─────────
  const checks = [
    {
      id: 11, sequence: 1, name: 'Frenos', check_type: 'yes_no', required: true,
      blocking_on_fail: true, passed: false, answered: false, not_passed_reason: '',
      expected_bool: true, min_value: null, max_value: null,
      result_bool: null, result_numeric: null, result_text: '', result_photo_url: null,
    },
    {
      id: 13, sequence: 2, name: 'Presión', check_type: 'numeric', required: true,
      blocking_on_fail: false, passed: false, answered: false, not_passed_reason: '',
      expected_bool: undefined, min_value: 30, max_value: 40,
      result_bool: null, result_numeric: null, result_text: '', result_photo_url: null,
    },
  ];

  // yes_no reprobado (valor != expected): answered=true, passed=false — la
  // política es documentar, no detener.
  const afterFail = applyLocalCheckAnswer(checks, 11, {
    result_bool: false, not_passed_reason: 'fuga',
  });
  assert.equal(afterFail[0].answered, true);
  assert.equal(afterFail[0].passed, false);
  assert.equal(afterFail[0].not_passed_reason, 'fuga');
  assert.equal(afterFail[1].answered, false, 'los demás checks no se tocan');

  // numeric dentro de límites: passed=true.
  const afterNumeric = applyLocalCheckAnswer(checks, 13, { result_numeric: 35 });
  assert.equal(afterNumeric[1].passed, true);
  // numeric fuera de límites: answered pero no passed.
  const afterOut = applyLocalCheckAnswer(checks, 13, { result_numeric: 90 });
  assert.equal(afterOut[1].answered, true);
  assert.equal(afterOut[1].passed, false);

  // ── areRequiredChecksAnswered (cuenta encolados/optimistas) ──────────────
  assert.equal(areRequiredChecksAnswered(checks), false);
  const allAnswered = applyLocalCheckAnswer(
    applyLocalCheckAnswer(checks, 11, { result_bool: false, not_passed_reason: 'fuga' }),
    13,
    { result_numeric: 35 },
  );
  assert.equal(
    areRequiredChecksAnswered(allAnswered),
    true,
    'un requerido REPROBADO pero respondido cuenta como listo: documenta, no detiene',
  );

  // ── La última respuesta por check reemplaza a sus predecesoras. `created_at`
  // manda incluso si la cola está desordenada; a igual fecha, gana el último
  // registro de la cola. Sólo una última respuesta dead va al banner. ───────
  const opsQueue = [
    { id: 'a1', type: 'vehicle_check', status: 'pending', created_at: 10, payload: { checklist_id: 3, check_id: 11 } },
    { id: 'a2', type: 'vehicle_check', status: 'error', created_at: 20, payload: { checklist_id: 3, check_id: 12 } },
    { id: 'a3', type: 'vehicle_check', status: 'dead', created_at: 30, payload: { checklist_id: 3, check_id: 13 } },
    { id: 'a4', type: 'vehicle_check', status: 'done', created_at: 40, payload: { checklist_id: 3, check_id: 14 } },
    { id: 'b1', type: 'vehicle_check', status: 'pending', created_at: 50, payload: { checklist_id: 9, check_id: 21 } },

    // El orden de la cola contradice el temporal: dead(t1) -> error(t2),
    // syncing(t2) y done(t2) deben ocultar sus dead(t1).
    { id: 'check-31-error-t2', type: 'vehicle_check', status: 'error', created_at: 200, payload: { checklist_id: 3, check_id: 31 } },
    { id: 'check-31-dead-t1', type: 'vehicle_check', status: 'dead', created_at: 100, payload: { checklist_id: 3, check_id: 31 } },
    { id: 'check-32-syncing-t2', type: 'vehicle_check', status: 'syncing', created_at: 400, payload: { checklist_id: 3, check_id: 32 } },
    { id: 'check-32-dead-t1', type: 'vehicle_check', status: 'dead', created_at: 300, payload: { checklist_id: 3, check_id: 32 } },
    { id: 'check-33-done-t2', type: 'vehicle_check', status: 'done', created_at: 600, payload: { checklist_id: 3, check_id: 33 } },
    { id: 'check-33-dead-t1', type: 'vehicle_check', status: 'dead', created_at: 500, payload: { checklist_id: 3, check_id: 33 } },

    // dead(t1) -> dead(t2): sólo hay un check_id terminal, aunque existan
    // dos registros dead para el mismo check.
    { id: 'check-34-dead-t2', type: 'vehicle_check', status: 'dead', created_at: 800, payload: { checklist_id: 3, check_id: 34 } },
    { id: 'check-34-dead-t1', type: 'vehicle_check', status: 'dead', created_at: 700, payload: { checklist_id: 3, check_id: 34 } },
    // La misma respuesta de otro checklist no comparte historial.
    { id: 'other-checklist-dead', type: 'vehicle_check', status: 'dead', created_at: 900, payload: { checklist_id: 9, check_id: 34 } },

    // Empates temporales se resuelven por el índice original: t2 está después.
    { id: 'check-35-error-t1', type: 'vehicle_check', status: 'error', created_at: 1_000, payload: { checklist_id: 3, check_id: 35 } },
    { id: 'check-35-pending-t2', type: 'vehicle_check', status: 'pending', created_at: 1_000, payload: { checklist_id: 3, check_id: 35 } },
    { id: 'check-36-error-t1', type: 'vehicle_check', status: 'error', created_at: 1_100, payload: { checklist_id: 3, check_id: 36 } },
    { id: 'check-36-done-t2', type: 'vehicle_check', status: 'done', created_at: 1_100, payload: { checklist_id: 3, check_id: 36 } },
    { id: 'c1', type: 'vehicle_checklist_complete', status: 'dead', created_at: 1_200, payload: { checklist_id: 3 } },
  ];
  assert.deepEqual(collectQueuedChecklistAnswerOps(opsQueue, 3), [
    'a1',
    'a2',
    'check-31-error-t2',
    'check-32-syncing-t2',
    'check-35-pending-t2',
  ]);
  assert.deepEqual(collectDeadChecklistAnswerCheckIds(opsQueue, 3), [13, 34]);
  assert.deepEqual(
    collectDeadChecklistAnswerOpIds([
      { id: 'dead-target-first', type: 'vehicle_check', status: 'dead', payload: { checklist_id: 3, check_id: 11 } },
      { id: 'pending-target', type: 'vehicle_check', status: 'pending', payload: { checklist_id: 3, check_id: 11 } },
      { id: 'dead-other-check', type: 'vehicle_check', status: 'dead', payload: { checklist_id: 3, check_id: 12 } },
      { id: 'dead-other-checklist', type: 'vehicle_check', status: 'dead', payload: { checklist_id: 9, check_id: 11 } },
      { id: 'dead-other-type', type: 'vehicle_checklist_complete', status: 'dead', payload: { checklist_id: 3, check_id: 11 } },
      { id: 'dead-target-second', type: 'vehicle_check', status: 'dead', payload: { checklist_id: 3, check_id: 11 } },
      { id: 'syncing-target', type: 'vehicle_check', status: 'syncing', payload: { checklist_id: 3, check_id: 11 } },
    ], 3, 11),
    ['dead-target-first', 'dead-target-second'],
    'la limpieza online conserva el orden y sólo selecciona respuestas dead del mismo checklist/check',
  );
  assert.equal(hasQueuedChecklistComplete(opsQueue, 3), false, 'un cierre dead permite reintentar');
  assert.equal(hasQueuedChecklistComplete(
    [...opsQueue, { id: 'c2', type: 'vehicle_checklist_complete', status: 'pending', payload: { checklist_id: 3 } }],
    3,
  ), true);
  assert.equal(hasQueuedChecklistCompleteForPlan(
    [{ id: 'c3', type: 'vehicle_checklist_complete', status: 'pending', payload: { checklist_id: 3, plan_id: 77 } }],
    77,
  ), true);
  assert.equal(hasQueuedChecklistCompleteForPlan(
    [{ id: 'c3', type: 'vehicle_checklist_complete', status: 'pending', payload: { checklist_id: 3, plan_id: 77 } }],
    88,
  ), false);

  console.log('vehicle checklist offline tests: ok');
}

void main();
