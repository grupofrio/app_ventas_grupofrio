export interface SalesLoadOptions {
  force?: boolean;
}

export interface SalesListPayload<TOrder> {
  count: number;
  orders: TOrder[];
}

export interface SalesLoadState<TSummary, TOrder> {
  summary: TSummary;
  orders: TOrder[];
  count: number;
  isLoading: boolean;
  error: string | null;
  lastLoadedAt: number | null;
}

export interface SalesLoadCoordinatorDependencies<TSummary, TOrder> {
  fetchSummary: () => Promise<TSummary>;
  fetchList: () => Promise<SalesListPayload<TOrder>>;
  getState: () => SalesLoadState<TSummary, TOrder>;
  setState: (patch: Partial<SalesLoadState<TSummary, TOrder>>) => void;
  now?: () => number;
  shouldSkip?: (state: SalesLoadState<TSummary, TOrder>) => boolean;
}

export interface SalesLoadCoordinator {
  (options?: SalesLoadOptions): Promise<void>;
  invalidate: () => void;
}

type QueueStatus = 'pending' | 'syncing' | 'done' | 'error' | 'dead';

interface QueueCandidate {
  id: string;
  type: 'sale_order';
  status: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function saleQueueCandidate(value: unknown): QueueCandidate | null {
  try {
    if (!isRecord(value) || value.type !== 'sale_order') return null;
    if (typeof value.id !== 'string') return null;

    const id = value.id.trim();
    if (!id) return null;

    return {
      id,
      type: 'sale_order',
      status: value.status,
    };
  } catch {
    return null;
  }
}

function isQueueStatus(value: unknown): value is QueueStatus {
  return value === 'pending'
    || value === 'syncing'
    || value === 'done'
    || value === 'error'
    || value === 'dead';
}

function priorStatusesBySaleId(queue: unknown): Map<string, Set<QueueStatus>> {
  const statuses = new Map<string, Set<QueueStatus>>();
  const items = queueItems(queue);
  if (items === null) return statuses;

  for (const value of items) {
    const candidate = saleQueueCandidate(value);
    if (!candidate) continue;

    const itemStatuses = statuses.get(candidate.id) ?? new Set<QueueStatus>();
    if (isQueueStatus(candidate.status)) {
      itemStatuses.add(candidate.status);
    }
    statuses.set(candidate.id, itemStatuses);
  }

  return statuses;
}

function queueItems(value: unknown): unknown[] | null {
  try {
    return Array.isArray(value) ? Array.from(value) : null;
  } catch {
    return null;
  }
}

export function shouldRefreshSalesAfterQueueChange(
  previousQueue: unknown,
  currentQueue: unknown,
): boolean {
  const currentItems = queueItems(currentQueue);
  if (currentItems === null) return false;
  const previousStatuses = priorStatusesBySaleId(previousQueue);

  for (const value of currentItems) {
    const candidate = saleQueueCandidate(value);
    if (!candidate || candidate.status !== 'done') continue;

    const prior = previousStatuses.get(candidate.id);
    if (prior === undefined || !prior.has('done')) {
      return true;
    }
  }

  return false;
}

function salesLoadErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'No se pudieron cargar las ventas.';
}

export function createSalesLoadCoordinator<TSummary, TOrder>(
  dependencies: SalesLoadCoordinatorDependencies<TSummary, TOrder>,
): SalesLoadCoordinator {
  interface ActiveRequest {
    promise: Promise<void>;
    resolve: () => void;
    generation: number;
  }

  let activeRequest: ActiveRequest | null = null;
  let generation = 0;

  const load = ((options?: SalesLoadOptions) => {
    if (activeRequest) return activeRequest.promise;

    let resolveRequest!: () => void;
    const requestPromise = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const request: ActiveRequest = {
      promise: requestPromise,
      resolve: resolveRequest,
      generation,
    };
    activeRequest = request;

    const isCurrent = () => (
      request.generation === generation
      && activeRequest === request
    );
    const finish = () => {
      if (activeRequest === request) {
        activeRequest = null;
      }
      request.resolve();
    };

    try {
      const currentState = dependencies.getState();
      if (!options?.force && dependencies.shouldSkip?.(currentState)) {
        finish();
        return requestPromise;
      }

      dependencies.setState({ isLoading: true, error: null });
      if (!isCurrent()) {
        finish();
        return requestPromise;
      }
    } catch (error) {
      if (isCurrent()) {
        try {
          dependencies.setState({
            isLoading: false,
            error: salesLoadErrorMessage(error),
          });
        } catch {
          // The state sink itself failed; still release the single-flight gate.
        }
      }
      finish();
      return requestPromise;
    }

    const run = Promise.resolve()
      .then(() => Promise.allSettled([
        Promise.resolve().then(dependencies.fetchSummary),
        Promise.resolve().then(dependencies.fetchList),
      ]))
      .then(([summaryResult, listResult]) => {
        if (!isCurrent()) return;
        if (summaryResult.status === 'rejected') {
          throw summaryResult.reason;
        }
        if (listResult.status === 'rejected') {
          throw listResult.reason;
        }

        dependencies.setState({
          summary: summaryResult.value,
          orders: listResult.value.orders,
          count: listResult.value.count,
          isLoading: false,
          error: null,
          lastLoadedAt: (dependencies.now ?? Date.now)(),
        });
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        dependencies.setState({
          isLoading: false,
          error: salesLoadErrorMessage(error),
        });
      });

    void run.then(finish, finish);
    return requestPromise;
  }) as SalesLoadCoordinator;

  load.invalidate = () => {
    generation += 1;
    activeRequest = null;
  };

  return load;
}
