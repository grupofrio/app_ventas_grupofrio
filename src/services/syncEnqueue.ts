import {
  SYNC_PRIORITY_MAP,
  type SyncEnqueueOptions,
  type SyncItemType,
  type SyncQueueItem,
} from '../types/sync.ts';

export interface ApplySyncEnqueueInput {
  queue: SyncQueueItem[];
  type: SyncItemType;
  payload: Record<string, unknown>;
  options?: SyncEnqueueOptions;
  generatedId: string;
  createdAt: number;
}

export interface ApplySyncEnqueueResult {
  id: string;
  queue: SyncQueueItem[];
  action: 'inserted' | 'reused' | 'rearmed_dead';
}

function resolveEnqueueId(options: SyncEnqueueOptions | undefined, generatedId: string): string {
  if (options?.operationId === undefined) return generatedId;
  if (typeof options.operationId !== 'string' || options.operationId.trim().length === 0) {
    throw new Error('operationId must be a non-empty string');
  }
  return options.operationId.trim();
}

export function applySyncEnqueue(input: ApplySyncEnqueueInput): ApplySyncEnqueueResult {
  const { queue, type, payload, options, generatedId, createdAt } = input;
  const id = resolveEnqueueId(options, generatedId);
  const existing = queue.find((item) => item.id === id);

  if (existing) {
    if (existing.type !== type) {
      throw new Error(`Sync operation id collision: ${id} already belongs to ${existing.type}`);
    }
    if (existing.status !== 'dead') {
      return { id, queue, action: 'reused' };
    }
    const rearmed = queue.map((item) =>
      item.id === id
        ? {
            ...item,
            status: 'pending' as const,
            retries: 0,
            error_message: null,
            next_retry_at: null,
          }
        : item,
    );
    return { id, queue: rearmed, action: 'rearmed_dead' };
  }

  const item: SyncQueueItem = {
    id,
    type,
    payload: { ...payload, _operationId: id },
    status: 'pending',
    created_at: createdAt,
    retries: 0,
    error_message: null,
    priority: SYNC_PRIORITY_MAP[type] ?? 3,
    next_retry_at: null,
    dependsOn: options?.dependsOn ? [...options.dependsOn] : undefined,
  };

  return { id, queue: [...queue, item], action: 'inserted' };
}
