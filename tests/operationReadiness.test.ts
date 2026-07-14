/**
 * P0-4 (hardening): guard de readiness para operar (venta/checkout/consignación/
 * cierre). Requiere plan activo + checklist respondido + KM inicial + carga
 * aceptada.
 */
import assert from 'node:assert/strict';

interface Mod {
  deriveOperationReadiness: (input: {
    hasActivePlan: boolean; checklistDone: boolean; kmCaptured: boolean; loadAccepted: boolean;
  }) => { canOperate: boolean; missing: string[]; warnings: string[]; reason: string | null };
}

function run(m: Mod) {
  const all = { hasActivePlan: true, checklistDone: true, kmCaptured: true, loadAccepted: true };
  const ok = m.deriveOperationReadiness(all);
  assert.equal(ok.canOperate, true);
  assert.equal(ok.missing.length, 0);
  assert.equal(ok.warnings.length, 0);
  assert.equal(ok.reason, null);

  // Each missing prerequisite blocks and is listed.
  const noPlan = m.deriveOperationReadiness({ ...all, hasActivePlan: false });
  assert.equal(noPlan.canOperate, false);
  assert.match(noPlan.missing.join(','), /plan/);
  assert.match(noPlan.reason ?? '', /Iniciar ruta/i);

  const checklistPending = m.deriveOperationReadiness({ ...all, checklistDone: false });
  assert.equal(checklistPending.canOperate, false);
  assert.deepEqual(checklistPending.missing, ['checklist de unidad']);
  assert.deepEqual(checklistPending.warnings, []);
  assert.match(checklistPending.reason ?? '', /checklist de unidad/i);

  assert.equal(m.deriveOperationReadiness({ ...all, kmCaptured: false }).canOperate, false);
  assert.equal(m.deriveOperationReadiness({ ...all, loadAccepted: false }).canOperate, false);

  // All missing → lists every hard blocker.
  const none = m.deriveOperationReadiness({
    hasActivePlan: false, checklistDone: false, kmCaptured: false, loadAccepted: false,
  });
  assert.deepEqual(none.missing, ['plan de ruta activo', 'checklist de unidad', 'KM inicial', 'aceptar carga']);
  assert.deepEqual(none.warnings, []);

  console.log('operation readiness tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/operationReadiness.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
