import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const syncStore = readFileSync(
  resolve(process.cwd(), 'src/stores/useSyncStore.ts'),
  'utf8',
);

const completionImport = syncStore.match(
  /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/services\/syncItemCompletion['"]/,
);
assert(completionImport, 'el store importa el contrato de finalización terminal');
assert.match(
  completionImport[1],
  /\bprocessSyncItemToCompletion\b/,
  'el store consume el helper conductual de finalización',
);
assert.match(
  completionImport[1],
  /\bisSaleTerminalMarkerPersistenceError\b/,
  'el store consume el guard seguro del fallo local',
);
assert.match(
  completionImport[1],
  /\bapplySaleTerminalMarkerDeferral\b/,
  'el store consume la transformación pura de deferral',
);
assert.match(
  syncStore,
  /const\s+MAX_RETRIES\s*=\s*3\s*;/,
  'el fix no cambia MAX_RETRIES global',
);
assert.match(
  syncStore,
  /import\s*\{\s*useVisitStore\s*\}\s*from\s*['"]\.\/useVisitStore['"]/,
  'sync puede persistir el marker terminal sin ciclo inverso desde visit',
);
assert.match(
  syncStore,
  /await processSyncItemToCompletion\(\{[\s\S]*?item,[\s\S]*?process:\s*processSyncItem,[\s\S]*?markSaleReadyToContinue:\s*\(operationId\)\s*=>\s*useVisitStore\.getState\(\)\.markSaleReadyToContinue\(operationId\),[\s\S]*?markDone:\s*\(id\)\s*=>\s*get\(\)\.markDone\(id\),[\s\S]*?\}\);/,
  'processOneItem delega process → marker estricto → markDone',
);

const processorStart = syncStore.indexOf('async function processOneItemUnheld(');
const processorEnd = syncStore.indexOf('// ═══ GPS Batch Processor ═══', processorStart);
assert(processorStart >= 0 && processorEnd > processorStart, 'se localiza processOneItemUnheld');
const processor = syncStore.slice(processorStart, processorEnd);
const catchStart = processor.indexOf('} catch (error: unknown) {');
assert(catchStart >= 0, 'se localiza el catch del procesador individual');
const catchBody = processor.slice(catchStart);
const markerBranchIndex = catchBody.indexOf('if (isSaleTerminalMarkerPersistenceError(error)) {');
const classifierIndex = catchBody.indexOf('shouldRetrySyncItemError(item.type, error)');
const deadIndex = catchBody.indexOf('get().markDead(');
const rollbackIndex = catchBody.indexOf('rollbackFailedOperation(item)');
assert(markerBranchIndex >= 0, 'el catch separa el fallo local del marker');
assert(
  markerBranchIndex < classifierIndex
    && markerBranchIndex < deadIndex
    && markerBranchIndex < rollbackIndex,
  'la rama local precede classifier, markDead y rollback',
);
const markerBranch = catchBody.slice(markerBranchIndex, classifierIndex);
assert.match(markerBranch, /const\s+backoffMs\s*=\s*calculateBackoff\(0\)/);
assert.match(markerBranch, /const\s+retryAt\s*=\s*Date\.now\(\)\s*\+\s*backoffMs/);
assert.match(
  markerBranch,
  /applySaleTerminalMarkerDeferral\(\s*get\(\)\.queue,\s*error\.operationId,\s*retryAt,?\s*\)/,
);
assert.match(markerBranch, /set\(\{\s*queue:\s*newQueue,\s*\.\.\.computeCounts\(newQueue\)\s*\}\)/);
assert.match(markerBranch, /schedulePersist\(\)/, 'el estado diferido usa la persistencia existente');
assert.match(
  markerBranch,
  /logWarn\(\s*['"]sync['"],\s*['"]sale_terminal_marker_deferred['"],\s*\{[\s\S]*?id:\s*error\.operationId,[\s\S]*?delay_ms:\s*backoffMs,?[\s\S]*?\}\s*\)/,
);
assert.doesNotMatch(markerBranch, /\.cause\b/, 'el log no expone la causa raw');
assert.doesNotMatch(
  markerBranch,
  /markError|markDead|rollbackFailedOperation|cascadeDeadToDependents/,
  'el fallo local no consume la política empresarial ni mata dependientes',
);
assert.match(markerBranch, /return\s+['"]deferred['"]/);
assert.match(
  syncStore,
  /if\s*\(outcome\s*===\s*['"]deferred['"]\)\s*hadDeferredStorageFailure\s*=\s*true/,
  'el outcome deferred activa la ruta post-ciclo de storage',
);
assert.match(
  syncStore,
  /decidePostCycleActionAfterCycle\(\{[\s\S]*?hadDeferredStorageFailure,[\s\S]*?\}\)[\s\S]*?get\(\)\.scheduleWake\(\)/,
  'la ruta post-ciclo agenda el wake de backoff existente',
);

console.log('sync sale terminal wiring tests: ok');
