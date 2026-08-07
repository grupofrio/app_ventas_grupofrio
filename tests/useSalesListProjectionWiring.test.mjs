import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const hook = readFileSync(
  resolve(REPO_ROOT, 'src/hooks/useSalesListProjection.ts'),
  'utf8',
);
const salesStore = readFileSync(
  resolve(REPO_ROOT, 'src/stores/useSalesStore.ts'),
  'utf8',
);
const salesTab = readFileSync(
  resolve(REPO_ROOT, 'app/(tabs)/sales.tsx'),
  'utf8',
);

function main() {
  // El hook se suscribe a la cola y a los pedidos remotos.
  assert.match(
    hook,
    /useSyncStore\(\(s\) => s\.queue\)/,
    'el hook debe suscribirse a la cola de sincronización',
  );
  assert.match(
    hook,
    /useSalesStore\(\(s\) => s\.orders\)/,
    'el hook debe suscribirse a los pedidos remotos',
  );

  // Firma estable de la cola: solo campos relevantes de sale_order, para que
  // un GPS encolado no relea tickets.
  assert.match(
    hook,
    /item\.type === 'sale_order'/,
    'la firma de la cola debe considerar solo sale_order',
  );
  assert.match(
    hook,
    /\$\{item\.id\}\|\$\{item\.status\}\|\$\{item\.error_message \?\? ''\}\|\$\{item\.created_at\}/,
    'la firma debe cubrir id/status/error_message/created_at',
  );

  // Gating de sesión: un done rehidratado nunca proyecta ni carga tickets.
  assert.match(
    hook,
    /collectSessionCompletedSales\(/,
    'el hook debe rastrear los done observados en esta sesión',
  );
  assert.match(
    hook,
    /selectProjectableSaleItems\(queue, sessionCompletedRef\.current\)/,
    'la proyección debe filtrar los done no observados en sesión',
  );
  assert.match(
    hook,
    /const hadPrevious = previousStatusesRef\.current !== null/,
    'el primer run (mount/rehydrate) no debe disparar refresh',
  );

  // Carga de tickets en lote a partir de los IDs proyectables.
  assert.match(
    hook,
    /collectLocalSaleOperationIds\(projectable\)/,
    'los tickets deben cargarse solo para ítems proyectables',
  );
  assert.match(
    hook,
    /loadSaleTicketSnapshots\(operationIds\)/,
    'el hook debe cargar los tickets en lote',
  );

  // Refresco forzado SOLO vía la política pura.
  assert.match(
    hook,
    /shouldRefreshSalesAfterQueueChange\(\{ previous, current \}\)/,
    'el refresco debe decidirse con la política pura de transiciones',
  );
  assert.match(
    hook,
    /loadTodaySales\(\{ force: true \}\)/,
    'el refresco tras done debe ser forzado',
  );

  // Merge con proyección pura.
  assert.match(
    hook,
    /mergeSalesListEntries\(\{/,
    'el hook debe combinar entradas con la proyección pura',
  );
  assert.match(
    hook,
    /summarizeLocalSales\(entries\)/,
    'el resumen local debe salir de la proyección',
  );

  // El store conserva datos remotos previos ante error (las tarjetas locales
  // permanecen si el remoto falla).
  assert.doesNotMatch(
    salesStore,
    /catch[\s\S]{0,200}orders:\s*\[\]/,
    'un error remoto no debe vaciar los pedidos ya cargados',
  );
  assert.match(
    salesStore,
    /loadTodaySales: \(options\?: \{ force\?: boolean \}\) => Promise<void>/,
    'el store debe exponer el refresco forzado',
  );

  // La pantalla consume la proyección; los KPI siguen leyendo solo summary.
  assert.match(
    salesTab,
    /useSalesListProjection\(\)/,
    'la pestaña Ventas debe consumir la proyección unificada',
  );
  assert.match(
    salesTab,
    /summary\.sales_amount_total/,
    'el KPI Vendido debe seguir leyendo el summary oficial',
  );
  assert.doesNotMatch(
    salesTab,
    /localSummary\.knownAmountTotal\s*\+\s*todaySales|todaySales\s*\+\s*localSummary/,
    'los pendientes locales nunca se suman al KPI oficial',
  );
  assert.match(
    salesTab,
    /key=\{entry\.key\}/,
    'las tarjetas deben usar la clave estable de la proyección',
  );
  assert.match(
    salesTab,
    /Pendiente de sincronizar/,
    'la pantalla debe mostrar el resumen de pendientes',
  );
  assert.match(
    salesTab,
    /router\.push\(`\/print\/\$\{entry\.operationId\}`/,
    'una tarjeta local navega al ticket por operationId',
  );
  assert.match(
    salesTab,
    /openSaleTicketForOrder\(entry\.remoteOrder/,
    'una tarjeta remota abre el ticket con el flujo autoritativo existente',
  );

  console.log('sales list projection wiring tests: ok');
}

main();
