/**
 * INV-1B — Ambiguous acknowledgement reconciliation (operation-identity based).
 *
 * Protocol:
 * 1. For ambiguous ledger ops (sale_order/gift without _serverAcknowledgedAtMs),
 *    ask the backend by operation identity (sales: check_duplicate; gift: idempotent replay).
 * 2. On COMMITTED → produce ACK intents (do NOT whole-replace a stale queue snapshot).
 * 3. Apply intents via serialized durable RMW on the *current* queue, then publish memory.
 * 4. Caller must then take a NEW truck_stock snapshot with snapshotAtMs >= ackAt.
 * 5. Keep-set drops a movement only when snapshotAtMs >= ackAt (never by qty heuristics).
 *
 * `snapshotAtMs` is a client ordering fence (request started after durable ACK), not a
 * server revision token.
 *
 * Fail-safe: reconcile/network timeout or durable ACK persist failure → leave unacked
 * → keep local movement.
 */

export const SERVER_ACK_AT_MS_KEY = '_serverAcknowledgedAtMs';

export type AmbiguousAckStatus =
  | 'not_found'
  | 'committed'
  | 'definitive_failure'
  | 'ambiguous';

export interface AmbiguousQueueItem {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  error_message?: string | null;
  next_retry_at?: number | null;
}

/** Intent produced after backend authority confirms COMMITTED. Applied later on current queue. */
export interface ServerAckIntent {
  item_id: string;
  operation_id: string;
  type: 'sale_order' | 'gift';
  acknowledged_at_ms: number;
}

export type ServerAckSkipReason =
  | 'not_found'
  | 'type_mismatch'
  | 'operation_id_mismatch'
  | 'dead'
  | 'unsupported_status';

export interface SaleDuplicateCheckResult {
  duplicate: boolean;
}

export interface AmbiguousAckReconcilePorts {
  nowMs: () => number;
  checkSaleDuplicate: (payload: Record<string, unknown>) => Promise<SaleDuplicateCheckResult>;
  replayGift: (payload: Record<string, unknown>) => Promise<void>;
  classifyGiftError: (error: unknown) => AmbiguousAckStatus;
  classifySaleCheckError: (error: unknown) => AmbiguousAckStatus;
}

export function readServerAcknowledgedAtMs(
  payload: Record<string, unknown> | undefined | null,
): number | null {
  if (!payload) return null;
  const raw = payload[SERVER_ACK_AT_MS_KEY];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function withServerAcknowledgedAtMs(
  payload: Record<string, unknown>,
  ackAtMs: number,
): Record<string, unknown> {
  return { ...payload, [SERVER_ACK_AT_MS_KEY]: ackAtMs };
}

export function resolveQueueItemOperationId(item: AmbiguousQueueItem): string {
  if (typeof item.payload.operation_id === 'string' && item.payload.operation_id.trim()) {
    return item.payload.operation_id.trim();
  }
  if (typeof item.payload._operationId === 'string' && item.payload._operationId.trim()) {
    return item.payload._operationId.trim();
  }
  const meta = item.payload.meta;
  if (meta && typeof meta === 'object') {
    const idem = (meta as Record<string, unknown>).idempotency_key;
    if (typeof idem === 'string' && idem.trim()) return idem.trim();
  }
  return item.id;
}

/**
 * Keep local ledger movements that are NOT yet confirmed by a snapshot
 * taken at-or-after server acknowledgement.
 *
 * - dead → never keep (reversal path owns stock)
 * - done without ack timestamp → treat as ackAt=0 (legacy / pre-INV1B)
 * - acked && snapshotAtMs >= ackAt → drop (safe; snapshot is post-ack)
 * - otherwise → keep
 *
 * Note: snapshotAtMs is a client fence, not a server stock revision.
 */
export function keepLedgerOperationIdsForSnapshot(
  queue: AmbiguousQueueItem[],
  snapshotAtMs: number,
  ledgerTypes: Set<string> = new Set(['sale_order', 'gift']),
): Set<string> {
  const keep = new Set<string>();
  for (const item of queue) {
    if (!ledgerTypes.has(item.type)) continue;
    if (item.status === 'dead') continue;

    const explicitAck = readServerAcknowledgedAtMs(item.payload);
    const ackAt =
      explicitAck !== null
        ? explicitAck
        : item.status === 'done'
          ? 0
          : null;

    if (ackAt !== null && snapshotAtMs >= ackAt) {
      continue;
    }

    keep.add(item.id);
    const payloadOp = item.payload.operation_id ?? item.payload._operationId;
    if (typeof payloadOp === 'string' && payloadOp.trim()) keep.add(payloadOp.trim());
    const meta = item.payload.meta;
    if (meta && typeof meta === 'object') {
      const idem = (meta as Record<string, unknown>).idempotency_key;
      if (typeof idem === 'string' && idem.trim()) keep.add(idem.trim());
    }
  }
  return keep;
}

export function isAmbiguousLedgerItem(item: AmbiguousQueueItem): boolean {
  if (item.type !== 'sale_order' && item.type !== 'gift') return false;
  if (item.status === 'dead' || item.status === 'done') return false;
  if (readServerAcknowledgedAtMs(item.payload) !== null) return false;
  return item.status === 'pending' || item.status === 'error' || item.status === 'syncing';
}

function buildSaleCheckPayload(item: AmbiguousQueueItem): Record<string, unknown> | null {
  const operationId = resolveQueueItemOperationId(item);
  const partnerId = item.payload.partner_id;
  if (typeof partnerId !== 'number' || partnerId <= 0) return null;
  const body: Record<string, unknown> = {
    operation_id: operationId,
    partner_id: partnerId,
  };
  // Intentionally omit created_at_ms — duplicate detection authority is operation_id
  // (no time-window heuristic). partner/stop/plan remain for tenancy/ownership scope.
  const stopId = item.payload.stop_id;
  if (typeof stopId === 'number' && stopId > 0) body.stop_id = stopId;
  const planId = item.payload.plan_id ?? item.payload.route_plan_id;
  if (typeof planId === 'number' && planId > 0) body.plan_id = planId;
  return body;
}

export interface ReconcileAmbiguousResult {
  intents: ServerAckIntent[];
  acknowledgedIds: string[];
}

/**
 * Apply ACK intents onto the latest queue snapshot.
 *
 * Matching requires item_id + operation_id + type. Unrelated rows are preserved.
 *
 * Status semantics:
 * - done + same operation → idempotent; fill missing ACK marker only
 * - pending | error | syncing + same operation → mark done + ACK
 * - dead → do not resurrect (skip)
 * - missing / mismatched identity → skip
 */
export function applyServerAckIntentsToQueue(
  queue: AmbiguousQueueItem[],
  intents: ServerAckIntent[],
): AmbiguousQueueItem[] {
  if (intents.length === 0) return queue;

  const intentByItemId = new Map<string, ServerAckIntent>();
  for (const intent of intents) {
    intentByItemId.set(intent.item_id, intent);
  }

  return queue.map((item) => {
    const intent = intentByItemId.get(item.id);
    if (!intent) return item;
    if (item.type !== intent.type) return item;
    if (resolveQueueItemOperationId(item) !== intent.operation_id) return item;

    if (item.status === 'dead') {
      return item;
    }

    if (item.status === 'done') {
      const existing = readServerAcknowledgedAtMs(item.payload);
      if (existing !== null) return item;
      return {
        ...item,
        payload: withServerAcknowledgedAtMs(item.payload, intent.acknowledged_at_ms),
        error_message: null,
        next_retry_at: null,
      };
    }

    if (item.status === 'pending' || item.status === 'error' || item.status === 'syncing') {
      return {
        ...item,
        status: 'done',
        payload: withServerAcknowledgedAtMs(item.payload, intent.acknowledged_at_ms),
        error_message: null,
        next_retry_at: null,
      };
    }

    return item;
  });
}

/** Observability helper — which intents did not land on the given queue snapshot. */
export function collectSkippedServerAckIntents(
  queue: AmbiguousQueueItem[],
  intents: ServerAckIntent[],
): Array<{ intent: ServerAckIntent; reason: ServerAckSkipReason }> {
  const skipped: Array<{ intent: ServerAckIntent; reason: ServerAckSkipReason }> = [];
  for (const intent of intents) {
    const item = queue.find((row) => row.id === intent.item_id);
    if (!item) {
      skipped.push({ intent, reason: 'not_found' });
      continue;
    }
    if (item.type !== intent.type) {
      skipped.push({ intent, reason: 'type_mismatch' });
      continue;
    }
    if (resolveQueueItemOperationId(item) !== intent.operation_id) {
      skipped.push({ intent, reason: 'operation_id_mismatch' });
      continue;
    }
    if (item.status === 'dead') {
      skipped.push({ intent, reason: 'dead' });
      continue;
    }
    if (
      item.status !== 'done'
      && item.status !== 'pending'
      && item.status !== 'error'
      && item.status !== 'syncing'
    ) {
      skipped.push({ intent, reason: 'unsupported_status' });
    }
  }
  return skipped;
}

/**
 * Network reconciliation only: produce ACK intents for COMMITTED ops.
 * Does not mutate the live queue — caller must apply intents durably on current state.
 */
export async function reconcileAmbiguousLedgerOperations(
  queue: AmbiguousQueueItem[],
  ports: AmbiguousAckReconcilePorts,
): Promise<ReconcileAmbiguousResult> {
  const intents: ServerAckIntent[] = [];

  for (const item of queue) {
    if (!isAmbiguousLedgerItem(item)) continue;
    if (item.type !== 'sale_order' && item.type !== 'gift') continue;

    try {
      if (item.type === 'sale_order') {
        const checkPayload = buildSaleCheckPayload(item);
        if (!checkPayload) continue;
        let status: AmbiguousAckStatus = 'ambiguous';
        try {
          const result = await ports.checkSaleDuplicate(checkPayload);
          status = result.duplicate ? 'committed' : 'not_found';
        } catch (error) {
          status = ports.classifySaleCheckError(error);
        }
        if (status === 'committed') {
          // Timestamp after authoritative COMMITTED confirmation.
          const ackAt = ports.nowMs();
          intents.push({
            item_id: item.id,
            operation_id: resolveQueueItemOperationId(item),
            type: 'sale_order',
            acknowledged_at_ms: ackAt,
          });
        }
        continue;
      }

      if (item.type === 'gift') {
        let status: AmbiguousAckStatus = 'ambiguous';
        try {
          await ports.replayGift(item.payload);
          status = 'committed';
        } catch (error) {
          status = ports.classifyGiftError(error);
        }
        if (status === 'committed') {
          const ackAt = ports.nowMs();
          intents.push({
            item_id: item.id,
            operation_id: resolveQueueItemOperationId(item),
            type: 'gift',
            acknowledged_at_ms: ackAt,
          });
        }
      }
    } catch {
      // Fail-safe: never drop local movement on unexpected reconcile errors.
    }
  }

  return {
    intents,
    acknowledgedIds: intents.map((intent) => intent.item_id),
  };
}

let reconcileFlight: Promise<ReconcileAmbiguousResult> | null = null;

/** Single-flight wrapper for production reconcile against live store ports. */
export async function runReconcileAmbiguousLedgerFlight(
  run: () => Promise<ReconcileAmbiguousResult>,
): Promise<ReconcileAmbiguousResult> {
  if (reconcileFlight) return reconcileFlight;
  reconcileFlight = (async () => {
    try {
      return await run();
    } finally {
      reconcileFlight = null;
    }
  })();
  return reconcileFlight;
}
