/**
 * INV-1B — Ambiguous acknowledgement reconciliation (operation-identity based).
 *
 * Protocol:
 * 1. For ambiguous ledger ops (sale_order/gift without _serverAcknowledgedAtMs),
 *    ask the backend by operation identity (sales: check_duplicate; gift: idempotent replay).
 * 2. On COMMITTED/ACK → durable `_serverAcknowledgedAtMs`.
 * 3. Caller must then take a NEW truck_stock snapshot with snapshotAtMs >= ackAt.
 * 4. Keep-set drops a movement only when snapshotAtMs >= ackAt (never by qty heuristics).
 *
 * Fail-safe: reconcile/network timeout → leave unacked → keep local movement.
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

/**
 * Keep local ledger movements that are NOT yet confirmed by a snapshot
 * taken at-or-after server acknowledgement.
 *
 * - dead → never keep (reversal path owns stock)
 * - done without ack timestamp → treat as ackAt=0 (legacy / pre-INV1B)
 * - acked && snapshotAtMs >= ackAt → drop (safe; snapshot is post-ack)
 * - otherwise → keep
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
  const operationId =
    (typeof item.payload.operation_id === 'string' && item.payload.operation_id.trim())
    || (typeof item.payload._operationId === 'string' && item.payload._operationId.trim())
    || item.id;
  const partnerId = item.payload.partner_id;
  if (typeof partnerId !== 'number' || partnerId <= 0) return null;
  const body: Record<string, unknown> = {
    operation_id: operationId,
    partner_id: partnerId,
  };
  // Intentionally omit created_at_ms — disables time-window heuristic.
  const stopId = item.payload.stop_id;
  if (typeof stopId === 'number' && stopId > 0) body.stop_id = stopId;
  const planId = item.payload.plan_id ?? item.payload.route_plan_id;
  if (typeof planId === 'number' && planId > 0) body.plan_id = planId;
  return body;
}

export interface ReconcileAmbiguousResult {
  acknowledgedIds: string[];
  /** Updated queue with durable ack markers (and done status for newly acked). */
  queue: AmbiguousQueueItem[];
}

/**
 * Pure reconcile against injected ports. Does not invent stock authority.
 */
export async function reconcileAmbiguousLedgerOperations(
  queue: AmbiguousQueueItem[],
  ports: AmbiguousAckReconcilePorts,
): Promise<ReconcileAmbiguousResult> {
  const acknowledgedIds: string[] = [];
  let next = queue.map((item) => ({
    ...item,
    payload: { ...item.payload },
  }));

  for (const item of next) {
    if (!isAmbiguousLedgerItem(item)) continue;
    const ackAt = ports.nowMs();

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
          next = next.map((row) =>
            row.id === item.id
              ? {
                  ...row,
                  status: 'done',
                  payload: withServerAcknowledgedAtMs(row.payload, ackAt),
                  error_message: null,
                  next_retry_at: null,
                } as AmbiguousQueueItem
              : row,
          );
          acknowledgedIds.push(item.id);
        }
        // not_found / ambiguous / definitive_failure → leave for processQueue / rollback policy
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
          next = next.map((row) =>
            row.id === item.id
              ? {
                  ...row,
                  status: 'done',
                  payload: withServerAcknowledgedAtMs(row.payload, ackAt),
                  error_message: null,
                  next_retry_at: null,
                } as AmbiguousQueueItem
              : row,
          );
          acknowledgedIds.push(item.id);
        }
      }
    } catch {
      // Fail-safe: never drop local movement on unexpected reconcile errors.
    }
  }

  return { acknowledgedIds, queue: next };
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
