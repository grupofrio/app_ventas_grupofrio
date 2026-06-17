import assert from 'node:assert/strict';

interface SyncDependencyItem {
  id: string;
  type?: string;
  status: 'pending' | 'syncing' | 'done' | 'error' | 'dead';
  dependsOn?: string[];
  error_message?: string | null;
  next_retry_at?: number | null;
}

interface SyncDependenciesModule {
  areSyncDependenciesSatisfied: (
    item: SyncDependencyItem,
    fullQueue: SyncDependencyItem[],
  ) => boolean;
  findLiveDependents: (
    parentId: string,
    queue: SyncDependencyItem[],
  ) => string[];
  cascadeDeadToDependents: (
    queue: SyncDependencyItem[],
    deadParentId: string,
  ) => SyncDependencyItem[];
  dependencyBlockedMessage: (type?: string) => string;
}

function testDependencyGate(m: SyncDependenciesModule) {
  const sale: SyncDependencyItem = { id: 'sale-1', type: 'sale_order', status: 'error' };
  const photo: SyncDependencyItem = {
    id: 'photo-1', type: 'photo', status: 'pending', dependsOn: ['sale-1'],
  };

  // Raíz del bug: la foto espera mientras la venta no está done…
  assert.equal(
    m.areSyncDependenciesSatisfied(photo, [sale, photo]),
    false,
    'dependent photo must wait when the sale is not done',
  );
  // …incluso si la venta murió (dead != done) — por eso necesita cascada.
  assert.equal(
    m.areSyncDependenciesSatisfied(photo, [{ ...sale, status: 'dead' }, photo]),
    false,
    'dead parent never satisfies the dependency → photo would be stuck pending',
  );
  assert.equal(
    m.areSyncDependenciesSatisfied(photo, [{ ...sale, status: 'done' }, photo]),
    true,
    'dependent photo can run after the sale is done',
  );
  // Padre ausente (ya limpiado) = satisfecho → la foto puede procesarse sola.
  assert.equal(
    m.areSyncDependenciesSatisfied(photo, [photo]),
    true,
    'missing parent (cleared) does not block the dependent',
  );
}

function testFindLiveDependents(m: SyncDependenciesModule) {
  const queue: SyncDependencyItem[] = [
    { id: 'sale-1', type: 'sale_order', status: 'dead' },
    { id: 'photo-1', type: 'photo', status: 'pending', dependsOn: ['sale-1'] },
    { id: 'photo-2', type: 'photo', status: 'error', dependsOn: ['sale-1'] },
    { id: 'photo-3', type: 'photo', status: 'done', dependsOn: ['sale-1'] },   // ya enviada → no
    { id: 'photo-4', type: 'photo', status: 'dead', dependsOn: ['sale-1'] },   // ya gestionada → no
    { id: 'photo-x', type: 'photo', status: 'pending', dependsOn: ['sale-OTHER'] }, // otro padre
    { id: 'gps-1', type: 'gps', status: 'pending' },                            // sin deps
  ];
  const live = m.findLiveDependents('sale-1', queue).sort();
  assert.deepEqual(live, ['photo-1', 'photo-2'], 'solo dependientes vivos del padre');
  assert.deepEqual(m.findLiveDependents('', queue), [], 'id vacío → []');
  assert.deepEqual(m.findLiveDependents('sale-NONE', queue), [], 'padre sin dependientes → []');
}

function testCascadeDeadToDependents(m: SyncDependenciesModule) {
  const queue: SyncDependencyItem[] = [
    { id: 'sale-1', type: 'sale_order', status: 'dead', error_message: 'rechazo Odoo' },
    { id: 'photo-1', type: 'photo', status: 'pending', dependsOn: ['sale-1'], next_retry_at: 123 },
    { id: 'photo-2', type: 'photo', status: 'done', dependsOn: ['sale-1'] },     // no se toca
    { id: 'gps-1', type: 'gps', status: 'pending' },                              // intacto
    { id: 'gift-1', type: 'gift', status: 'pending' },                            // intacto
    { id: 'nosale-1', type: 'no_sale', status: 'pending' },                       // intacto
  ];
  const out = m.cascadeDeadToDependents(queue, 'sale-1');

  const photo1 = out.find((i) => i.id === 'photo-1')!;
  assert.equal(photo1.status, 'dead', 'foto pendiente del padre muerto → dead (no queda pending eterna)');
  assert.match(photo1.error_message ?? '', /venta falló/i, 'mensaje claro de causa');
  assert.equal(photo1.next_retry_at, null, 'sin reintento agendado');

  const photo2 = out.find((i) => i.id === 'photo-2')!;
  assert.equal(photo2.status, 'done', 'dependiente ya enviado no se altera');

  // No afecta gift/gps/no-sale ni cualquier item sin relación.
  for (const id of ['gps-1', 'gift-1', 'nosale-1']) {
    assert.equal(out.find((i) => i.id === id)!.status, 'pending', `${id} intacto`);
  }
  // Pureza: no muta la entrada.
  assert.equal(queue.find((i) => i.id === 'photo-1')!.status, 'pending', 'entrada inmutada');
  // id vacío → cola sin cambios (misma referencia).
  assert.equal(m.cascadeDeadToDependents(queue, ''), queue);
}

function testMessages(m: SyncDependenciesModule) {
  assert.match(m.dependencyBlockedMessage('photo'), /Foto/i);
  assert.match(m.dependencyBlockedMessage('payment'), /depende/i);
  assert.match(m.dependencyBlockedMessage(), /depende/i);
}

// @ts-ignore -- Node runs this ESM test harness directly.
const module = await import(
  // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
  new URL('../src/services/syncDependencies.ts', import.meta.url).pathname
) as SyncDependenciesModule;

testDependencyGate(module);
testFindLiveDependents(module);
testCascadeDeadToDependents(module);
testMessages(module);

console.log('sync dependencies tests: ok');
