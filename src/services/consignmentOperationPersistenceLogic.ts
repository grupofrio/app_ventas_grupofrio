export type ConsignmentOperationKind = 'create' | 'visit' | 'close';

export interface ConsignmentPendingOperations {
  create?: string;
  visit?: string;
  close?: string;
}

interface StoredConsignmentPendingOperations {
  version: 1;
  sessionId: string;
  operations: ConsignmentPendingOperations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parsePendingOperations(value: unknown): ConsignmentPendingOperations | null {
  if (!isRecord(value)) return null;
  const operations: ConsignmentPendingOperations = {};
  for (const kind of ['create', 'visit', 'close'] as const) {
    const operationId = value[kind];
    if (operationId === undefined) continue;
    if (typeof operationId !== 'string' || operationId.trim() !== operationId || !operationId) {
      return null;
    }
    operations[kind] = operationId;
  }
  return operations;
}

export function decodePendingOperations(
  raw: string | null,
  sessionId: string,
): ConsignmentPendingOperations | null {
  if (!raw || !sessionId) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || parsed.sessionId !== sessionId) return null;
    return parsePendingOperations(parsed.operations);
  } catch {
    return null;
  }
}

export function encodePendingOperations(
  sessionId: string,
  operations: ConsignmentPendingOperations,
): string {
  const payload: StoredConsignmentPendingOperations = {
    version: 1,
    sessionId,
    operations,
  };
  return JSON.stringify(payload);
}

export function withPendingOperation(
  operations: ConsignmentPendingOperations,
  kind: ConsignmentOperationKind,
  operationId: string,
): ConsignmentPendingOperations {
  return { ...operations, [kind]: operationId };
}

export function withoutPendingOperation(
  operations: ConsignmentPendingOperations,
  kind: ConsignmentOperationKind,
): ConsignmentPendingOperations {
  const { [kind]: _removed, ...remaining } = operations;
  return remaining;
}

export function hasPendingOperations(operations: ConsignmentPendingOperations): boolean {
  return Object.keys(operations).length > 0;
}
