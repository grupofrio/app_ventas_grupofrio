import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hookPath = resolve(
  process.cwd(),
  'src/hooks/useSalesListProjection.ts',
);
const hook = existsSync(hookPath)
  ? readFileSync(hookPath, 'utf8')
  : '';

assert.match(
  hook,
  /useSyncStore\(\(state\)\s*=>\s*state\.queue\)/,
  'el hook debe suscribirse a la cola para conservar las ventas locales',
);
assert.match(
  hook,
  /useSalesStore\(\(state\)\s*=>\s*state\.orders\)/,
  'el hook debe consumir las ventas autoritativas que el store ya conserva',
);
assert.match(
  hook,
  /useSalesStore\(\(state\)\s*=>\s*state\.loadTodaySales\)/,
  'el hook debe usar el action single-flight para refrescar ventas',
);

for (const collaborator of [
  'collectLocalSaleOperationIds',
  'loadSaleTicketSnapshots',
  'projectLocalSale',
  'mergeSalesListEntries',
  'summarizeLocalSales',
  'shouldRefreshSalesAfterQueueChange',
]) {
  assert.match(
    hook,
    new RegExp(`\\b${collaborator}\\b`),
    `el hook debe integrar ${collaborator}`,
  );
}

assert.match(
  hook,
  /item\.type\s*!==\s*['"]sale_order['"]/,
  'la firma de tickets debe ignorar cambios ajenos a ventas',
);
assert.match(
  hook,
  /item\.id[\s\S]*item\.status[\s\S]*item\.error_message[\s\S]*item\.created_at/,
  'la firma debe incluir identidad, estado, error y fecha de cada venta local',
);
assert.match(
  hook,
  /JSON\.stringify\(/,
  'la firma debe conservar de forma inequívoca el orden relevante de la cola',
);

assert.match(
  hook,
  /ticketLoadGenerationRef\s*=\s*useRef\(0\)/,
  'cada carga de tickets debe tener una generación monotónica',
);
assert.match(
  hook,
  /\+\+ticketLoadGenerationRef\.current/,
  'cada cambio de firma debe invalidar resultados anteriores',
);
assert.match(
  hook,
  /generation\s*!==\s*ticketLoadGenerationRef\.current/,
  'una carga obsoleta no debe publicar sus tickets',
);
assert.match(
  hook,
  /\.catch\(\(\)\s*=>\s*\{[\s\S]*new Map/,
  'un fallo total inesperado debe degradar a proyección local sin tickets',
);
assert.match(
  hook,
  /\.finally\(\(\)\s*=>\s*\{[\s\S]*setTicketsLoading\(false\)/,
  'la carga debe terminar incluso cuando el almacenamiento falla',
);

assert.match(
  hook,
  /hasObservedQueueRef\s*=\s*useRef\(false\)/,
  'la primera observación debe inicializar el snapshot sin refrescar',
);
assert.match(
  hook,
  /if\s*\(!hasObservedQueueRef\.current\)\s*\{[\s\S]*previousQueueRef\.current\s*=\s*queue[\s\S]*return;/,
  'el mount no debe interpretarse como transición a done',
);
assert.match(
  hook,
  /shouldRefreshSalesAfterQueueChange\(\s*previousQueue,\s*queue,?\s*\)/,
  'solo la policy probada debe decidir si una transición refresca ventas',
);
assert.match(
  hook,
  /loadTodaySales\(\{\s*force:\s*true\s*\}\)/,
  'una transición aprobada debe solicitar un refresh forzado coalescido',
);

assert.match(
  hook,
  /mergeSalesListEntries\(\{[\s\S]*remoteOrders:\s*orders[\s\S]*localEntries[\s\S]*localDay/,
  'la lista debe fusionar las ventas remotas conservadas con las locales',
);
assert.match(
  hook,
  /summarizeLocalSales\(localEntries\)/,
  'el resumen pendiente debe calcularse exclusivamente con ventas locales',
);
assert.match(
  hook,
  /return\s*\{\s*entries,\s*localSummary,\s*ticketsLoading,?\s*\};/,
  'el contrato público del hook debe exponer exactamente los tres campos aprobados',
);

console.log('sales list projection hook wiring tests: ok');
