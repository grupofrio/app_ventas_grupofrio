import { postRest } from './api';
import { storeLoad, storeSave } from '../persistence/storage';
import { useAuthStore } from '../stores/useAuthStore';
import {
  FIELD_EVENT_PATH,
  buildOperationFailureReport,
  enqueueOperationFailure,
  isFieldEventEndpointMissing,
  isFieldEventPayloadRejected,
  operationNameForSyncType,
  type OperationFailureInput,
  type OperationFailureOutcome,
  type OperationFailureReport,
} from './operationFailureReportLogic.ts';

const CACHE_KEY = 'sync:operation-failures';
const READ_TIMEOUT_MS = 8_000;
const MISSING_ENDPOINT_MS = 15 * 60 * 1000;

let missingUntil = 0;
let tail: Promise<void> = Promise.resolve();

function schedule(work: () => Promise<void>): void {
  tail = tail.then(work, work);
}

async function loadQueue(): Promise<OperationFailureReport[]> {
  const raw = await storeLoad<unknown>(CACHE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is OperationFailureReport => {
    if (!item || typeof item !== 'object') return false;
    const record = item as OperationFailureReport;
    return typeof record.operation === 'string' && typeof record.error_code === 'string';
  });
}

async function flushQueue(): Promise<void> {
  if (Date.now() < missingUntil) return;
  const queue = await loadQueue();
  if (queue.length === 0) return;
  const remaining: OperationFailureReport[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const report = queue[index];
    try {
      await postRest(FIELD_EVENT_PATH, { ...report }, { timeoutMs: READ_TIMEOUT_MS });
    } catch (error) {
      if (isFieldEventPayloadRejected(error)) continue;
      remaining.push(...queue.slice(index));
      if (isFieldEventEndpointMissing(error)) {
        missingUntil = Date.now() + MISSING_ENDPOINT_MS;
      }
      break;
    }
  }
  await storeSave(CACHE_KEY, remaining);
}

export function reportOperationFailure(input: OperationFailureInput): void {
  schedule(async () => {
    const sellerName = useAuthStore.getState().employeeName ?? '';
    const report = buildOperationFailureReport(input, sellerName, new Date().toISOString());
    if (!report) return;
    const next = enqueueOperationFailure(await loadQueue(), report);
    await storeSave(CACHE_KEY, next);
    await flushQueue();
  });
}

export function reportDeadSyncItem(
  item: { id: string; type: string; payload?: Record<string, unknown> | null; error_message?: string | null },
  error?: unknown,
  outcome: OperationFailureOutcome = 'dead',
): void {
  if (item.type === 'gps') return;
  const stopId = typeof item.payload?.stop_id === 'number' ? item.payload.stop_id : null;
  const planId = typeof item.payload?.plan_id === 'number' ? item.payload.plan_id : null;
  reportOperationFailure({
    operation: operationNameForSyncType(item.type),
    operationId: item.id,
    stopId,
    planId,
    error: error ?? { code: outcome === 'rejected' ? 'SYNC_REJECTED' : 'SYNC_DEAD', message: item.error_message || 'La operación quedó sin sincronizar.' },
    outcome,
  });
}
