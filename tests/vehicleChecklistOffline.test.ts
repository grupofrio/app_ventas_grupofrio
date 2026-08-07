import assert from 'node:assert/strict';

async function main() {
  // @ts-ignore -- Node 24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/vehicleChecklistOffline.ts', import.meta.url).pathname
  );

  const {
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

  console.log('vehicle checklist offline tests: ok');
}

void main();
