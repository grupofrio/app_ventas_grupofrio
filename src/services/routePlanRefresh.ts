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

const VALID_PLAN_STATES = new Set([
  'draft',
  'confirmed',
  'published',
  'in_progress',
  'closed',
  'reconciled',
  'done',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function invalidMyPlanResponse(reason: string): Error & { code: 'invalid_response' } {
  const error = new Error(`Respuesta inválida de my_plan: ${reason}`) as Error & {
    code: 'invalid_response';
  };
  error.code = 'invalid_response';
  return error;
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
  if (!isRecord(result)) {
    throw invalidMyPlanResponse('se esperaba un objeto');
  }

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

  const data = Object.prototype.hasOwnProperty.call(result, 'data')
    ? envelope.data
    : result;
  if (!isRecord(data)) {
    throw invalidMyPlanResponse('data no contiene un objeto');
  }

  const planPayload = data as { found?: boolean; plan?: unknown };
  if (planPayload.found === false) return null;

  const candidate = Object.prototype.hasOwnProperty.call(data, 'plan')
    ? planPayload.plan
    : data;
  if (!isRecord(candidate)) {
    throw invalidMyPlanResponse('plan no contiene un objeto');
  }

  const planId = candidate.plan_id;
  if (!Number.isInteger(planId) || Number(planId) <= 0) {
    throw invalidMyPlanResponse('plan_id debe ser un entero positivo');
  }
  if (typeof candidate.state !== 'string' || !VALID_PLAN_STATES.has(candidate.state)) {
    throw invalidMyPlanResponse('state no es válido');
  }

  return candidate as unknown as GFPlan;
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

export interface SingleFlightContext {
  generation: number;
  isCurrent: () => boolean;
}

export interface SingleFlight<T> {
  run: (task: (context: SingleFlightContext) => Promise<T>) => Promise<T>;
  invalidate: () => void;
}

/** Join concurrent callers to one active operation, then allow a new flight. */
export function createSingleFlight<T>(): SingleFlight<T> {
  let generation = 0;
  let inFlight: { generation: number; promise: Promise<T> } | null = null;

  return {
    run(task) {
      if (inFlight?.generation === generation) return inFlight.promise;

      const flightGeneration = generation;

      let resolveFlight!: (value: T | PromiseLike<T>) => void;
      let rejectFlight!: (reason?: unknown) => void;
      const current = new Promise<T>((resolve, reject) => {
        resolveFlight = resolve;
        rejectFlight = reject;
      });
      inFlight = { generation: flightGeneration, promise: current };

      try {
        task({
          generation: flightGeneration,
          isCurrent: () => generation === flightGeneration,
        }).then(resolveFlight, rejectFlight);
      } catch (error) {
        rejectFlight(error);
      }

      const clear = () => {
        if (inFlight?.promise === current) inFlight = null;
      };
      void current.then(clear, clear);
      return current;
    },
    invalidate() {
      generation += 1;
      inFlight = null;
    },
  };
}
