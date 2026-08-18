import { requestFromIntent, type InvoiceCollectionIntent, type InvoiceCollectionServerResult, type InvoiceCollectionStatus } from './invoiceCollection.ts';

type PersistedStatus = Extract<InvoiceCollectionStatus, 'pending' | 'applied' | 'review_required' | 'reauth_required'>;

export interface InvoiceCollectionIntentPersistence {
  list(): Promise<InvoiceCollectionIntent[]>;
  insert(intent: InvoiceCollectionIntent): Promise<void>;
  findOrInsert(intent: InvoiceCollectionIntent): Promise<InvoiceCollectionIntent>;
  transition(operationId: string, status: PersistedStatus, nowMs: number): Promise<void>;
  markReauthenticationRequired?(): Promise<void>;
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

type InvoiceCollectionSyncProcessor = ReturnType<typeof createInvoiceCollectionSyncProcessor>;

export interface InvoiceCollectionDirectCaptureDeps {
  createProcessor: () => Promise<Pick<InvoiceCollectionSyncProcessor, 'capture'>>;
}

export interface InvoiceCollectionGatedCaptureDeps {
  assertCurrentEmployeeDayBundleAllowsActions: () => Promise<void>;
  createIntent: (input: unknown) => InvoiceCollectionIntent;
  captureIntent: (intent: InvoiceCollectionIntent) => Promise<InvoiceCollectionCaptureResult>;
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
  /** The encrypted intent exists, but its latest server outcome is uncertain. */
  needsReconciliation?: true;
};

/** A capture failure before the encrypted intent commit point. */
export class InvoiceCollectionCaptureFailure extends Error {
  readonly durableIntent: boolean;

  constructor(message: string, durableIntent: boolean) {
    super(message);
    this.name = 'InvoiceCollectionCaptureFailure';
    this.durableIntent = durableIntent;
  }
}

export function isInvoiceCollectionCaptureFailure(error: unknown): error is InvoiceCollectionCaptureFailure {
  return error instanceof InvoiceCollectionCaptureFailure;
}

function preCommitCaptureFailure(error: unknown): InvoiceCollectionCaptureFailure {
  if (isInvoiceCollectionCaptureFailure(error)) return error;
  return new InvoiceCollectionCaptureFailure(
    error instanceof Error ? error.message : 'No se pudo guardar el cobro de forma cifrada.',
    false,
  );
}

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
  let reauthenticationPaused = false;
  let retired = false;
  const operations = new Map<string, Promise<InvoiceCollectionCaptureResult>>();
  const durableMutations = new Set<Promise<unknown>>();
  function trackDurableMutation<T>(mutation: Promise<T>): Promise<T> {
    durableMutations.add(mutation);
    void mutation.then(
      () => { durableMutations.delete(mutation); },
      () => { durableMutations.delete(mutation); },
    );
    return mutation;
  }
  function reconciliationPending(intent: InvoiceCollectionIntent): InvoiceCollectionCaptureResult {
    return { status: 'pending', operationId: intent.operation_id, needsReconciliation: true };
  }
  async function send(intent: InvoiceCollectionIntent): Promise<InvoiceCollectionCaptureResult> {
    if (retired) return reconciliationPending(intent);
    let result: InvoiceCollectionServerResult;
    try {
      result = await deps.transport.collect(requestFromIntent(intent));
    } catch (error) {
      if (retired) return reconciliationPending(intent);
      const outcome = classifyInvoiceCollectionError(error);
      const errorDetails = {
        ...(outcome.code === undefined ? {} : { code: outcome.code }),
        ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
      };
      if (outcome.kind === 'reauth_required') {
        // Fail closed immediately. The encrypted marker is the restart-safe
        // source of truth; this latch also protects the current runtime when
        // that marker cannot be committed.
        reauthenticationPaused = true;
        try {
          await trackDurableMutation(
            deps.persistence.transition(intent.operation_id, 'reauth_required', deps.now()),
          );
        } catch {
          try {
            const latchMutation = deps.persistence.markReauthenticationRequired?.();
            if (latchMutation) await trackDurableMutation(latchMutation);
          } catch {
            // No restart-safe claim is possible when both independent durable
            // writes fail. The runtime latch above still prevents fail-open
            // sends until authentication resets this processor.
          }
          return {
            status: 'reauth_required',
            operationId: intent.operation_id,
            needsReconciliation: true,
            ...errorDetails,
          };
        }
        return { status: 'reauth_required', operationId: intent.operation_id, ...errorDetails };
      }
      const status: PersistedStatus = outcome.kind === 'review_required' ? 'review_required' : 'pending';
      try {
        await trackDurableMutation(deps.persistence.transition(intent.operation_id, status, deps.now()));
      } catch {
        // The intent was committed before the POST. Its status could not be
        // updated, so preserve the UUID and require reconciliation instead of
        // claiming that the payment was not registered.
        return reconciliationPending(intent);
      }
      return { status, operationId: intent.operation_id, ...errorDetails };
    }
    if (retired) return reconciliationPending(intent);
    const status: PersistedStatus = result.status === 'applied' ? 'applied' : 'review_required';
    // Persist acknowledgement before publishing it. A crash here only causes
    // an idempotent replay under the original UUID on restart.
    try {
      await trackDurableMutation(deps.persistence.transition(intent.operation_id, status, deps.now()));
    } catch {
      return reconciliationPending(intent);
    }
    return { status, operationId: intent.operation_id };
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
        if (retired) {
          throw new InvoiceCollectionCaptureFailure('La sesión de cobranza cambió.', false);
        }
        // This awaited encrypted write is the commit point before first send.
        let effective: InvoiceCollectionIntent;
        try {
          effective = await trackDurableMutation(deps.persistence.findOrInsert(intent));
        } catch (error) {
          throw preCommitCaptureFailure(error);
        }
        if (retired) return reconciliationPending(effective);
        const inFlight = operations.get(effective.operation_id);
        if (inFlight) return inFlight;
        if (effective.status === 'applied') {
          return { status: 'applied' as const, operationId: effective.operation_id };
        }
        if (effective.status === 'review_required') {
          return { status: 'review_required' as const, operationId: effective.operation_id };
        }
        if (reauthenticationPaused || effective.status === 'reauth_required') {
          return { status: 'reauth_required' as const, operationId: effective.operation_id };
        }
        if (!deps.isOnline()) {
          try {
            await trackDurableMutation(
              deps.persistence.transition(effective.operation_id, 'pending', deps.now()),
            );
          } catch {
            return reconciliationPending(effective);
          }
          return { status: 'captured_pending' as const, operationId: effective.operation_id };
        }
        return sendOnce(effective);
      })();
    },
    reconcile(): Promise<void> {
      if (reconciliation) return reconciliation;
      reconciliation = (async () => {
        if (retired || reauthenticationPaused || !deps.isOnline()) return;
        const intents = await deps.persistence.list();
        if (intents.some((intent) => intent.status === 'reauth_required')) return;
        for (const intent of intents) {
          if (retired || reauthenticationPaused || !deps.isOnline()) break;
          const latest = await deps.persistence.list();
          if (retired) break;
          if (latest.some((candidate) => candidate.status === 'reauth_required')) break;
          const current = latest.find((candidate) => candidate.operation_id === intent.operation_id);
          if (current && !isTerminal(current.status)) {
            const result = await sendOnce(current);
            if (result.status === 'reauth_required') break;
          }
        }
      })().finally(() => { reconciliation = null; });
      return reconciliation;
    },
    async retire(): Promise<void> {
      retired = true;
      reauthenticationPaused = true;
      while (durableMutations.size > 0) {
        await Promise.allSettled([...durableMutations]);
      }
    },
  };
}

/**
 * Direct collection capture is deliberately a thin entry point over the same
 * processor used for bootstrap and reconnect reconciliation. It creates no
 * queue, dispatcher, or second retry runner.
 */
export function createInvoiceCollectionDirectCapture(deps: InvoiceCollectionDirectCaptureDeps) {
  let processor: Promise<Pick<InvoiceCollectionSyncProcessor, 'capture'>> | null = null;
  function current() {
    if (processor) return processor;
    const created = deps.createProcessor();
    processor = created;
    void created.catch(() => {
      if (processor === created) processor = null;
    });
    return created;
  }
  return async (intent: InvoiceCollectionIntent): Promise<InvoiceCollectionCaptureResult> => {
    let currentProcessor: Pick<InvoiceCollectionSyncProcessor, 'capture'>;
    try {
      currentProcessor = await current();
    } catch (error) {
      throw preCommitCaptureFailure(error);
    }
    return currentProcessor.capture(intent);
  };
}

/** Applies the authoritative day-bundle gate before an intent can exist. */
export function createInvoiceCollectionGatedCapture(deps: InvoiceCollectionGatedCaptureDeps) {
  return async (input: unknown): Promise<InvoiceCollectionCaptureResult> => {
    let intent: InvoiceCollectionIntent;
    try {
      await deps.assertCurrentEmployeeDayBundleAllowsActions();
      intent = deps.createIntent(input);
    } catch (error) {
      throw preCommitCaptureFailure(error);
    }
    return deps.captureIntent(intent);
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
    if (processor) return processor;
    const created = deps.createProcessor();
    processor = created;
    void created.catch(() => {
      if (processor === created) processor = null;
    });
    return created;
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

export interface InvoiceCollectionSyncRuntimeDeps {
  createProcessor: () => Promise<InvoiceCollectionSyncProcessor>;
}

/** One processor owner shared by direct capture, startup, and reconnect. */
export function createInvoiceCollectionSyncRuntime(deps: InvoiceCollectionSyncRuntimeDeps) {
  let processor: Promise<InvoiceCollectionSyncProcessor> | null = null;
  let resolvedProcessor: InvoiceCollectionSyncProcessor | null = null;
  let retired = false;
  function currentProcessor() {
    if (processor) return processor;
    const created = deps.createProcessor().then(async (current) => {
      resolvedProcessor = current;
      if (retired) await current.retire();
      return current;
    });
    processor = created;
    void created.catch(() => {
      if (processor === created) processor = null;
    });
    return created;
  }
  const directCapture = createInvoiceCollectionDirectCapture({ createProcessor: currentProcessor });
  const bootstrap = createInvoiceCollectionSyncBootstrap({ createProcessor: currentProcessor });
  return {
    capture: (intent: InvoiceCollectionIntent): Promise<InvoiceCollectionCaptureResult> => {
      if (retired) {
        return Promise.reject(new InvoiceCollectionCaptureFailure('La sesión de cobranza cambió.', false));
      }
      return directCapture(intent);
    },
    bootstrap: (): Promise<void> => retired ? Promise.resolve() : bootstrap.bootstrap(),
    requestReconnect: (): Promise<void> => retired ? Promise.resolve() : bootstrap.requestReconnect(),
    async retire(): Promise<void> {
      retired = true;
      try {
        const current = resolvedProcessor ?? (processor ? await processor : null);
        await current?.retire();
      } catch {
        // A processor that never initialized has no session-bound writes to drain.
      }
    },
  };
}

/** Prevents a replacement runtime from binding while the prior session is being destroyed. */
export function createInvoiceCollectionSyncRuntimeLifecycle<T extends { retire(): Promise<void> }>(
  createRuntime: () => T,
) {
  let runtime: T | null = null;
  let suspended = false;
  return {
    current(): T | null {
      if (suspended) return null;
      runtime ??= createRuntime();
      return runtime;
    },
    async suspend(): Promise<void> {
      suspended = true;
      const previous = runtime;
      await previous?.retire();
      if (runtime === previous) runtime = null;
    },
    resume(): void {
      suspended = false;
    },
  };
}

let productionCapture: ReturnType<typeof createInvoiceCollectionGatedCapture> | null = null;

const productionRuntimeLifecycle = createInvoiceCollectionSyncRuntimeLifecycle(() =>
  createInvoiceCollectionSyncRuntime({
    createProcessor: async () => {
      const [persistence, { submitInvoiceCollection }, { useSyncStore }, { useAuthStore }] = await Promise.all([
        import('./invoiceCollectionPersistence.ts').then((module) => module.createCurrentInvoiceCollectionPersistence()),
        import('./invoiceCollection.ts'),
        import('../stores/useSyncStore.ts'),
        import('../stores/useAuthStore.ts'),
      ]);
      return createInvoiceCollectionSyncProcessor({
        persistence,
        transport: { collect: submitInvoiceCollection },
        isOnline: () => useSyncStore.getState().isOnline && useAuthStore.getState().isAuthenticated,
        now: () => Date.now(),
      });
    },
  }));

function currentProductionRuntime(): ReturnType<typeof createInvoiceCollectionSyncRuntime> | null {
  return productionRuntimeLifecycle.current();
}

/**
 * Production entry point for the collection screen. Its gate runs before the
 * UUID intent is created, so stale bundles cannot write encrypted state or
 * send the strict collection POST.
 */
export async function captureCurrentInvoiceCollection(input: unknown): Promise<InvoiceCollectionCaptureResult> {
  try {
    if (!productionCapture) {
      const [{ assertCurrentEmployeeDayBundleAllowsActions }, { createInvoiceCollectionIntent }] = await Promise.all([
        import('./dayBundleMutationGate.ts'), import('./invoiceCollection.ts'),
      ]);
      productionCapture = createInvoiceCollectionGatedCapture({
        assertCurrentEmployeeDayBundleAllowsActions,
        createIntent: createInvoiceCollectionIntent,
        captureIntent: (intent) => {
          const runtime = currentProductionRuntime();
          if (!runtime) throw new InvoiceCollectionCaptureFailure('La sesión de cobranza cambió.', false);
          return runtime.capture(intent);
        },
      });
    }
    return await productionCapture(input);
  } catch (error) {
    throw preCommitCaptureFailure(error);
  }
}

/** Creates the production processor after auth/session restoration, then rehydrates its encrypted intents. */
export async function bootstrapInvoiceCollectionSync(): Promise<void> {
  await currentProductionRuntime()?.bootstrap();
}

/** Called from the existing NetInfo/foreground wake; safe before bootstrap. */
export function requestInvoiceCollectionSync(): void {
  const runtime = currentProductionRuntime();
  if (!runtime) return;
  void runtime.requestReconnect().catch(() => {
    // Connectivity can wake before auth restoration. The shared runtime clears
    // a rejected processor promise so the post-rehydrate wake can retry it.
  });
}

/** Auth logout/account-switch retires old writes before discarding their owner. */
export async function resetInvoiceCollectionSync(): Promise<void> {
  productionCapture = null;
  await productionRuntimeLifecycle.suspend();
}

/** Auth calls this only after the replacement principal/session is installed. */
export function resumeInvoiceCollectionSync(): void {
  productionRuntimeLifecycle.resume();
}
