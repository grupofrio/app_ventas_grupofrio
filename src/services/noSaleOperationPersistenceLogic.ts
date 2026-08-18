function createUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for constrained runtimes (still RFC4122 v4 shape).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type NoSaleIntentState = 'open' | 'completed' | 'rejected';

export interface NoSaleIntentV1 {
  version: 1;
  operation_id: string;
  stop_id: number;
  plan_id: number | null;
  operational_date: string | null;
  reason_code: string;
  reason_id: number | null;
  notes: string;
  competitor: string | null;
  photo_uris: string[];
  state: NoSaleIntentState;
  created_at: string;
  updated_at: string;
}

export interface NoSaleIntentKeyParts {
  operationalDate: string | null;
  planId: number | null;
  stopId: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function noSaleIntentRecordKey(parts: NoSaleIntentKeyParts): string {
  const day = parts.operationalDate?.trim() || 'unknown-day';
  const plan = parts.planId && parts.planId > 0 ? String(parts.planId) : 'no-plan';
  return `nosale:intent:v1:${day}:${plan}:${parts.stopId}`;
}

export function parseNoSaleIntent(value: unknown): NoSaleIntentV1 | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (typeof value.operation_id !== 'string' || !isUuidV4(value.operation_id)) return null;
  if (typeof value.stop_id !== 'number' || !Number.isInteger(value.stop_id) || value.stop_id <= 0) {
    return null;
  }
  if (value.plan_id !== null && (typeof value.plan_id !== 'number' || !Number.isInteger(value.plan_id))) {
    return null;
  }
  if (value.operational_date !== null && typeof value.operational_date !== 'string') return null;
  if (typeof value.reason_code !== 'string' || !value.reason_code.trim()) return null;
  if (value.reason_id !== null && (typeof value.reason_id !== 'number' || !Number.isInteger(value.reason_id))) {
    return null;
  }
  if (typeof value.notes !== 'string') return null;
  if (value.competitor !== null && typeof value.competitor !== 'string') return null;
  if (!Array.isArray(value.photo_uris) || !value.photo_uris.every((u) => typeof u === 'string')) {
    return null;
  }
  if (value.state !== 'open' && value.state !== 'completed' && value.state !== 'rejected') return null;
  if (typeof value.created_at !== 'string' || typeof value.updated_at !== 'string') return null;

  return {
    version: 1,
    operation_id: value.operation_id,
    stop_id: value.stop_id,
    plan_id: value.plan_id,
    operational_date: value.operational_date,
    reason_code: value.reason_code.trim().toLowerCase(),
    reason_id: value.reason_id,
    notes: value.notes,
    competitor: value.competitor,
    photo_uris: value.photo_uris,
    state: value.state,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

export function createOpenNoSaleIntent(input: {
  stopId: number;
  planId: number | null;
  operationalDate: string | null;
  reasonCode: string;
  reasonId: number | null;
  notes: string;
  competitor: string | null;
  photoUris: string[];
  nowIso?: string;
  operationId?: string;
}): NoSaleIntentV1 {
  const now = input.nowIso ?? new Date().toISOString();
  return {
    version: 1,
    operation_id: input.operationId ?? createUuidV4(),
    stop_id: input.stopId,
    plan_id: input.planId,
    operational_date: input.operationalDate,
    reason_code: input.reasonCode.trim().toLowerCase(),
    reason_id: input.reasonId,
    notes: input.notes,
    competitor: input.competitor,
    photo_uris: [...input.photoUris],
    state: 'open',
    created_at: now,
    updated_at: now,
  };
}

export function withNoSaleIntentState(
  intent: NoSaleIntentV1,
  state: NoSaleIntentState,
  nowIso?: string,
): NoSaleIntentV1 {
  return {
    ...intent,
    state,
    updated_at: nowIso ?? new Date().toISOString(),
  };
}

/** Reuse open intent when same stop binding; otherwise mint only after terminal. */
export function resolveNoSaleOperationId(args: {
  existing: NoSaleIntentV1 | null;
  stopId: number;
  reasonCode: string;
}): { operationId: string; reuse: boolean } {
  if (
    args.existing
    && args.existing.state === 'open'
    && args.existing.stop_id === args.stopId
  ) {
    return { operationId: args.existing.operation_id, reuse: true };
  }
  return { operationId: createUuidV4(), reuse: false };
}
