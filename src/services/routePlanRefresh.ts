import type { GFPlan } from '../types/plan';

export type MyPlanRequest = (
  url: string,
  data: Record<string, unknown>,
) => Promise<unknown>;

interface MyPlanEnvelope {
  ok?: boolean;
  message?: unknown;
  data?: unknown;
  code?: unknown;
}

/**
 * Fetch and decode the current employee plan without confusing failures with
 * the authoritative "no plan assigned" response.
 */
export async function fetchMyPlan(
  request: MyPlanRequest,
  endpoint: string,
  date: string,
): Promise<GFPlan | null> {
  const result = await request(endpoint, { date });
  if (!result || typeof result !== 'object') return null;

  const envelope = result as MyPlanEnvelope;
  if (envelope.ok === false) {
    const message = typeof envelope.message === 'string' && envelope.message.trim().length > 0
      ? envelope.message
      : 'No se pudo cargar el plan';
    const error = new Error(message) as Error & { code?: string };
    if (typeof envelope.code === 'string' && envelope.code.length > 0) {
      error.code = envelope.code;
    }
    throw error;
  }

  const data = envelope.data !== undefined ? envelope.data : result;
  if (!data || typeof data !== 'object') return null;

  const planPayload = data as { found?: boolean; plan?: unknown };
  if (planPayload.found === false) return null;
  return (planPayload.plan ?? data) as GFPlan;
}

export function buildRouteRefreshFailurePatch(error: unknown): {
  isLoading: false;
  error: string;
  routeFreshness: 'stale';
} {
  return {
    isLoading: false,
    error: error instanceof Error ? error.message : 'Error cargando plan',
    routeFreshness: 'stale',
  };
}

export interface SingleFlight<T> {
  run: (task: () => Promise<T>) => Promise<T>;
}

/** Join concurrent callers to one active operation, then allow a new flight. */
export function createSingleFlight<T>(): SingleFlight<T> {
  let inFlight: Promise<T> | null = null;

  return {
    run(task) {
      if (inFlight) return inFlight;

      let resolveFlight!: (value: T | PromiseLike<T>) => void;
      let rejectFlight!: (reason?: unknown) => void;
      const current = new Promise<T>((resolve, reject) => {
        resolveFlight = resolve;
        rejectFlight = reject;
      });
      inFlight = current;

      try {
        task().then(resolveFlight, rejectFlight);
      } catch (error) {
        rejectFlight(error);
      }

      const clear = () => {
        if (inFlight === current) inFlight = null;
      };
      void current.then(clear, clear);
      return current;
    },
  };
}
