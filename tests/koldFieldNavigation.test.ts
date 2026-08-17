/**
 * Canonical tab model: 5 primary + Tasks/Alerts secondary (href hidden).
 */
import assert from 'node:assert/strict';

interface TabDef {
  name: string;
  title: string;
  primary: boolean;
}

interface Mod {
  KOLD_FIELD_PRIMARY_TABS: readonly TabDef[];
  KOLD_FIELD_SECONDARY_TABS: readonly TabDef[];
  KOLD_FIELD_ALL_TABS: readonly TabDef[];
  primaryTabNames: () => string[];
  isPrimaryTab: (name: string) => boolean;
}

function run(m: Mod) {
  assert.deepEqual(m.primaryTabNames(), ['index', 'route', 'inventory', 'sales', 'me']);

  assert.equal(m.KOLD_FIELD_PRIMARY_TABS.length, 5);
  assert.equal(m.KOLD_FIELD_PRIMARY_TABS.every((t) => t.primary), true);
  assert.deepEqual(
    m.KOLD_FIELD_PRIMARY_TABS.map((t) => t.title),
    ['Mi día', 'Ruta', 'Inventario', 'Ventas', 'Yo'],
  );

  assert.equal(m.KOLD_FIELD_SECONDARY_TABS.length, 2);
  assert.equal(m.KOLD_FIELD_SECONDARY_TABS.every((t) => t.primary === false), true);
  assert.deepEqual(
    m.KOLD_FIELD_SECONDARY_TABS.map((t) => t.name),
    ['tasks', 'alerts'],
  );

  assert.equal(m.KOLD_FIELD_ALL_TABS.length, 7);
  assert.equal(m.isPrimaryTab('index'), true);
  assert.equal(m.isPrimaryTab('me'), true);
  assert.equal(m.isPrimaryTab('tasks'), false);
  assert.equal(m.isPrimaryTab('alerts'), false);
  assert.equal(m.isPrimaryTab('unknown'), false);

  console.log('koldFieldNavigation tests: ok');
}

async function main() {
  const m = (await import(
    // @ts-ignore
    new URL('../src/services/koldFieldNavigation.ts', import.meta.url).pathname
  )) as Mod;
  run(m);
}
void main();
