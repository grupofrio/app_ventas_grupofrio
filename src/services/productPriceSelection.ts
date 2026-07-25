import type { CapturedCustomerPrice } from './customerPricingSnapshot';

export interface ProductPriceSelectionInput {
  readonly isOnline: boolean;
  readonly snapshotPrice: CapturedCustomerPrice | null;
  readonly publicPrice: number;
}

export interface ProductPriceSelection {
  readonly price: CapturedCustomerPrice;
  readonly requiresPublicFallbackConfirmation: boolean;
}

export interface ProductSelectionReadinessInput {
  readonly isOnline: boolean;
  readonly partnerId: number | null;
  readonly publishedPricingContextKey: string | null;
  readonly currentPricingContextKey: string;
  readonly isRefreshing: boolean;
}

export interface ProductSelectionReadiness {
  readonly canSelect: boolean;
  readonly isWaitingForCustomerPrice: boolean;
  readonly isRefreshingCustomerPrice: boolean;
}

export function decideProductSelectionReadiness(
  input: ProductSelectionReadinessInput,
): ProductSelectionReadiness {
  const hasCustomerPricingContext =
    input.isOnline
    && typeof input.partnerId === 'number'
    && Number.isInteger(input.partnerId)
    && input.partnerId > 0;
  const hasExactPublishedContext =
    input.publishedPricingContextKey !== null
    && input.publishedPricingContextKey === input.currentPricingContextKey;
  const canSelect =
    !hasCustomerPricingContext || hasExactPublishedContext;

  return {
    canSelect,
    isWaitingForCustomerPrice:
      hasCustomerPricingContext && !hasExactPublishedContext,
    isRefreshingCustomerPrice:
      hasCustomerPricingContext
      && hasExactPublishedContext
      && input.isRefreshing,
  };
}

export interface ProductPricingInFlightLoader {
  run<T>(
    contextKey: string,
    load: () => Promise<T>,
    options?: { readonly force?: boolean },
  ): Promise<T>;
}

export function createProductPricingInFlightLoader(): ProductPricingInFlightLoader {
  const inFlight = new Map<string, Promise<unknown>>();

  return {
    run<T>(
      contextKey: string,
      load: () => Promise<T>,
      options: { readonly force?: boolean } = {},
    ): Promise<T> {
      const existing = inFlight.get(contextKey) as Promise<T> | undefined;
      if (existing && !options.force) return existing;

      const request = load().finally(() => {
        if (inFlight.get(contextKey) === request) {
          inFlight.delete(contextKey);
        }
      });
      inFlight.set(contextKey, request);
      return request;
    },
  };
}

export interface ProductPricingCaptureIdentity {
  readonly capturedAtMs: number;
  readonly captureRunId: string;
}

export interface ProductPricingRequestToken {
  readonly generation: number;
  readonly contextKey: string;
  readonly capture: ProductPricingCaptureIdentity;
}

export interface LatestProductPricingRequestGate {
  begin(
    contextKey: string,
    capture: ProductPricingCaptureIdentity,
  ): ProductPricingRequestToken;
  isCurrent(token: ProductPricingRequestToken): boolean;
  waitUntilCurrent(token: ProductPricingRequestToken): Promise<boolean>;
  runCommitIfCurrent(
    token: ProductPricingRequestToken,
    commit: () => Promise<void>,
  ): Promise<boolean>;
  cancel(token: ProductPricingRequestToken): boolean;
  invalidate(): void;
}

export function createLatestProductPricingRequestGate(): LatestProductPricingRequestGate {
  let generation = 0;
  let current: ProductPricingRequestToken | null = null;
  let commitLease: ProductPricingRequestToken | null = null;
  let queuedTransition:
    | { kind: 'activate'; token: ProductPricingRequestToken }
    | { kind: 'invalidate' }
    | null = null;
  const activationWaiters = new Map<
    ProductPricingRequestToken,
    Set<(activated: boolean) => void>
  >();

  const settleActivation = (
    token: ProductPricingRequestToken,
    activated: boolean,
  ) => {
    const waiters = activationWaiters.get(token);
    if (!waiters) return;
    activationWaiters.delete(token);
    for (const resolve of waiters) resolve(activated);
  };

  const replaceQueuedTransition = (
    next:
      | { kind: 'activate'; token: ProductPricingRequestToken }
      | { kind: 'invalidate' },
  ) => {
    if (queuedTransition?.kind === 'activate') {
      settleActivation(queuedTransition.token, false);
    }
    queuedTransition = next;
  };

  const releaseCommitLease = () => {
    commitLease = null;
    const transition = queuedTransition;
    queuedTransition = null;
    if (!transition) return;
    if (transition.kind === 'invalidate') {
      current = null;
      return;
    }
    current = transition.token;
    settleActivation(transition.token, true);
  };

  const isLogicallyCurrent = (token: ProductPricingRequestToken) =>
    current === token && queuedTransition === null;

  return {
    begin(contextKey, capture) {
      generation += 1;
      const token = Object.freeze({
        generation,
        contextKey,
        capture: Object.freeze({ ...capture }),
      });
      if (commitLease) {
        replaceQueuedTransition({ kind: 'activate', token });
      } else {
        current = token;
      }
      return token;
    },
    isCurrent(token) {
      return isLogicallyCurrent(token);
    },
    waitUntilCurrent(token) {
      if (isLogicallyCurrent(token)) return Promise.resolve(true);
      if (
        queuedTransition?.kind !== 'activate'
        || queuedTransition.token !== token
      ) {
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const waiters = activationWaiters.get(token) ?? new Set();
        waiters.add(resolve);
        activationWaiters.set(token, waiters);
      });
    },
    async runCommitIfCurrent(token, commit) {
      if (commitLease || !isLogicallyCurrent(token)) return false;
      commitLease = token;
      try {
        await commit();
        return true;
      } finally {
        releaseCommitLease();
      }
    },
    cancel(token) {
      if (
        commitLease
        && queuedTransition?.kind === 'activate'
        && queuedTransition.token === token
      ) {
        replaceQueuedTransition({ kind: 'invalidate' });
        return true;
      }
      if (!isLogicallyCurrent(token)) return false;
      generation += 1;
      if (commitLease === token) {
        replaceQueuedTransition({ kind: 'invalidate' });
      } else {
        current = null;
      }
      return true;
    },
    invalidate() {
      generation += 1;
      if (commitLease) {
        replaceQueuedTransition({ kind: 'invalidate' });
      } else {
        current = null;
      }
    },
  };
}

export interface ProductSelectionCommitToken {
  readonly generation: number;
  readonly contextKey: string;
}

export interface ProductSelectionCommitGuard {
  begin(contextKey: string): ProductSelectionCommitToken | null;
  commit(token: ProductSelectionCommitToken, sink: () => void): boolean;
  cancel(token: ProductSelectionCommitToken): boolean;
  cancelUncommitted(): boolean;
  invalidate(): void;
}

export function createProductSelectionCommitGuard(): ProductSelectionCommitGuard {
  let generation = 0;
  let active: {
    token: ProductSelectionCommitToken;
    committed: boolean;
  } | null = null;

  return {
    begin(contextKey) {
      if (active) return null;
      generation += 1;
      const token = Object.freeze({ generation, contextKey });
      active = { token, committed: false };
      return token;
    },
    commit(token, sink) {
      if (!active || active.token !== token || active.committed) return false;
      active.committed = true;
      sink();
      return true;
    },
    cancel(token) {
      if (!active || active.token !== token || active.committed) return false;
      active = null;
      return true;
    },
    cancelUncommitted() {
      if (!active || active.committed) return false;
      active = null;
      return true;
    },
    invalidate() {
      active = null;
    },
  };
}

function assertValidPrice(unitPrice: number, label: string): void {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new RangeError(`invalid ${label} product price`);
  }
}

export function selectProductPrice(
  input: ProductPriceSelectionInput,
): ProductPriceSelection {
  let price: CapturedCustomerPrice;

  if (input.snapshotPrice) {
    assertValidPrice(input.snapshotPrice.unitPrice, 'selected');
    price = { ...input.snapshotPrice };
  } else {
    assertValidPrice(input.publicPrice, 'public');
    price = {
      unitPrice: input.publicPrice,
      source: 'public_fallback',
      capturedAtMs: null,
      pricelistId: null,
    };
  }

  return {
    price,
    requiresPublicFallbackConfirmation:
      !input.isOnline && price.source === 'public_fallback',
  };
}
