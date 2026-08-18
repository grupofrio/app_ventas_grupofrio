import { requestFromIntent, type InvoiceCollectionIntent, type InvoiceCollectionServerResult, type InvoiceCollectionStatus } from './invoiceCollection.ts';

type PersistedStatus = Extract<InvoiceCollectionStatus, 'pending' | 'applied' | 'review_required'>;

export interface InvoiceCollectionIntentPersistence {
  list(): Promise<InvoiceCollectionIntent[]>;
  insert(intent: InvoiceCollectionIntent): Promise<void>;
  findOrInsert(intent: InvoiceCollectionIntent): Promise<InvoiceCollectionIntent>;
  transition(operationId: string, status: PersistedStatus, nowMs: number): Promise<void>;
}

export interface InvoiceCollectionTransport {
  collect(request: ReturnType<typeof requestFromIntent>): Promise<InvoiceCollectionServerResult>;
}

export interface InvoiceCollectionSyncDeps {
  persistence: InvoiceCollectionIntentPersistence;
  transport: InvoiceCollectionTransport;
  isOnline: () => boolean;
  now: () => number;
}

export interface InvoiceCollectionErrorMetadata {
  code?: string;
  httpStatus?: number;
  responseReceived?: boolean;
  message?: string;
}

export type InvoiceCollectionErrorKind = 'pending' | 'review_required' | 'reauth_required';

export type InvoiceCollectionCaptureResult = {
  status: 'applied' | 'captured_pending' | 'pending' | 'review_required' | 'reauth_required';
  operationId: string;
  code?: string;
  httpStatus?: number;
};

function errorMetadata(error: unknown): InvoiceCollectionErrorMetadata {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return {};
  const read = (key: string): unknown => {
    try { return (error as Record<string, unknown>)[key]; } catch { return undefined; }
  };
  const code = read('code');
  const httpStatus = read('httpStatus');
  const responseReceived = read('responseReceived');
  const message = read('message');
  return {
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof httpStatus === 'number' && Number.isFinite(httpStatus) ? { httpStatus } : {}),
    ...(typeof responseReceived === 'boolean' ? { responseReceived } : {}),
    ...(typeof message === 'string' ? { message } : {}),
  };
}

const REAUTH_CODES = new Set(['session_expired', 'unauthorized', 'invalid_token', 'token_revoked', 'bearer_invalid']);
const TRANSIENT_ERROR = /timeout|timedout|network|abort|econn|enet|connection\s+(?:lost|failed|reset|refused)|sin respuesta/i;

/** Classifies failures without erasing the original transport metadata. */
export function classifyInvoiceCollectionError(error: unknown): InvoiceCollectionErrorMetadata & { kind: InvoiceCollectionErrorKind } {
  const metadata = errorMetadata(error);
  const publicOutcome = (kind: InvoiceCollectionErrorKind) => ({
    kind,
    ...(metadata.code === undefined ? {} : { code: metadata.code }),
    ...(metadata.httpStatus === undefined ? {} : { httpStatus: metadata.httpStatus }),
  });
  const code = metadata.code?.trim().toLowerCase();
  if (metadata.httpStatus === 401 || (code !== undefined && REAUTH_CODES.has(code))) {
    return publicOutcome('reauth_required');
  }
  if (metadata.httpStatus === 408 || metadata.httpStatus === 429) {
    return publicOutcome('pending');
  }
  if (metadata.httpStatus !== undefined && metadata.httpStatus >= 400 && metadata.httpStatus <= 499) {
    return publicOutcome('review_required');
  }
  if (metadata.httpStatus !== undefined && metadata.httpStatus >= 500) {
    return publicOutcome('pending');
  }
  if (metadata.responseReceived === false || (code && TRANSIENT_ERROR.test(code)) || (metadata.message && TRANSIENT_ERROR.test(metadata.message))) {
    return publicOutcome('pending');
  }
  return publicOutcome('pending');
}

function isTerminal(status: InvoiceCollectionIntent['status']): boolean {
  return status === 'applied' || status === 'review_required';
}

export function createInvoiceCollectionSyncProcessor(deps: InvoiceCollectionSyncDeps) {
  let reconciliation: Promise<void> | null = null;
  const operations = new Map<string, Promise<InvoiceCollectionCaptureResult>>();
  async function send(intent: InvoiceCollectionIntent): Promise<InvoiceCollectionCaptureResult> {
    try {
      const result = await deps.transport.collect(requestFromIntent(intent));
      const status: PersistedStatus = result.status === 'applied' ? 'applied' : 'review_required';
      // Persist acknowledgement before publishing it. A crash here only causes
      // an idempotent replay under the original UUID on restart.
      await deps.persistence.transition(intent.operation_id, status, deps.now());
      return { status, operationId: intent.operation_id };
    } catch (error) {
      const outcome = classifyInvoiceCollectionError(error);
      const errorDetails = {
        ...(outcome.code === undefined ? {} : { code: outcome.code }),
        ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
      };
      if (outcome.kind === 'reauth_required') {
        // Invalid/revoked credentials cannot be reconciled safely. Keep the
        // durable intent untouched for a later authenticated replay.
        return { status: 'reauth_required', operationId: intent.operation_id, ...errorDetails };
      }
      const status: PersistedStatus = outcome.kind === 'review_required' ? 'review_required' : 'pending';
      await deps.persistence.transition(intent.operation_id, status, deps.now());
      return { status, operationId: intent.operation_id, ...errorDetails };
    }
  }
  function sendOnce(intent: InvoiceCollectionIntent): Promise<InvoiceCollectionCaptureResult> {
    const inFlight = operations.get(intent.operation_id);
    if (inFlight) return inFlight;
    const operation = send(intent);
    operations.set(intent.operation_id, operation);
    void operation.then(
      () => { operations.delete(intent.operation_id); },
      () => { operations.delete(intent.operation_id); },
    );
    return operation;
  }
  return {
    capture(intent: InvoiceCollectionIntent): Promise<InvoiceCollectionCaptureResult> {
      return (async () => {
        // This awaited encrypted write is the commit point before first send.
        const effective = await deps.persistence.findOrInsert(intent);
        if (effective.status === 'review_required') {
          return { status: 'review_required' as const, operationId: effective.operation_id };
        }
        if (!deps.isOnline()) {
          await deps.persistence.transition(effective.operation_id, 'pending', deps.now());
          return { status: 'captured_pending' as const, operationId: effective.operation_id };
        }
        return sendOnce(effective);
      })();
    },
    reconcile(): Promise<void> {
      if (reconciliation) return reconciliation;
      reconciliation = (async () => {
        if (!deps.isOnline()) return;
        for (const intent of await deps.persistence.list()) {
          const current = (await deps.persistence.list()).find((candidate) => candidate.operation_id === intent.operation_id);
          if (current && !isTerminal(current.status)) await sendOnce(current);
        }
      })().finally(() => { reconciliation = null; });
      return reconciliation;
    },
  };
}

export interface InvoiceCollectionSyncBootstrapDeps {
  createProcessor: () => Promise<Pick<ReturnType<typeof createInvoiceCollectionSyncProcessor>, 'reconcile'>>;
}

/**
 * One lifetime-owned processor. Startup and the existing connectivity monitor
 * share it; this is intentionally not a second generic queue/dispatcher.
 */
export function createInvoiceCollectionSyncBootstrap(deps: InvoiceCollectionSyncBootstrapDeps) {
  let processor: Promise<Pick<ReturnType<typeof createInvoiceCollectionSyncProcessor>, 'reconcile'>> | null = null;
  function current() {
    processor ??= deps.createProcessor();
    return processor;
  }
  return {
    async bootstrap(): Promise<void> {
      await (await current()).reconcile();
    },
    async requestReconnect(): Promise<void> {
      await (await current()).reconcile();
    },
  };
}

let productionBootstrap: ReturnType<typeof createInvoiceCollectionSyncBootstrap> | null = null;

/** Creates the production processor after auth/session restoration, then rehydrates its encrypted intents. */
export async function bootstrapInvoiceCollectionSync(): Promise<void> {
  if (!productionBootstrap) {
    productionBootstrap = createInvoiceCollectionSyncBootstrap({
      createProcessor: async () => {
        const [persistence, { submitInvoiceCollection }, { useSyncStore }] = await Promise.all([
          import('./invoiceCollectionPersistence.ts').then((module) => module.createCurrentInvoiceCollectionPersistence()),
          import('./invoiceCollection.ts'),
          import('../stores/useSyncStore.ts'),
        ]);
        return createInvoiceCollectionSyncProcessor({
          persistence,
          transport: { collect: submitInvoiceCollection },
          isOnline: () => useSyncStore.getState().isOnline,
          now: () => Date.now(),
        });
      },
    });
  }
  await productionBootstrap.bootstrap();
}

/** Called from the existing NetInfo/foreground wake; safe before bootstrap. */
export function requestInvoiceCollectionSync(): void {
  void productionBootstrap?.requestReconnect();
}

/** Auth logout/account-switch discards the old session-bound processor. */
export function resetInvoiceCollectionSync(): void {
  productionBootstrap = null;
}
