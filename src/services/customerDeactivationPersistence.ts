import type {CustomerDeactivationScope, CustomerDeactivationSummary} from '../types/customerDeactivation';
import {sameCustomerDeactivationScope, parseCustomerDeactivationResponse} from './customerDeactivationLogic.ts';

interface Dependencies {
  getScope: (stopId: number) => Promise<CustomerDeactivationScope>;
  save: (scope: CustomerDeactivationScope, key: string, value: unknown) => Promise<void>;
  load: (scope: CustomerDeactivationScope, key: string) => Promise<unknown>;
}

/** Dedicated encrypted records avoid clobbering a concurrent route edit with a stale stop array. */
export function createCustomerDeactivationPersistence(deps: Dependencies) {
  const key = (scope: CustomerDeactivationScope, stopId: number) => `customer-deactivation:${scope.operationalDate}:${scope.planId}:${stopId}`;
  const assertScope = async (scope: CustomerDeactivationScope, stopId: number) => {
    if (!sameCustomerDeactivationScope(scope, await deps.getScope(stopId))) throw new Error('Cambió la sesión, ruta o día de la solicitud.');
  };
  return {
    async save(scope: CustomerDeactivationScope, stopId: number, result: CustomerDeactivationSummary | null) {
      await assertScope(scope, stopId);
      const validated = parseCustomerDeactivationResponse(result, stopId, true);
      await deps.save(scope, key(scope, stopId), {scope, result: validated});
      await assertScope(scope, stopId);
    },
    async load(scope: CustomerDeactivationScope, stopId: number): Promise<CustomerDeactivationSummary | null> {
      await assertScope(scope, stopId);
      const stored = await deps.load(scope, key(scope, stopId));
      await assertScope(scope, stopId);
      if (stored === null) return null;
      const envelope = stored as {scope: CustomerDeactivationScope; result: unknown};
      if (!envelope || !sameCustomerDeactivationScope(scope, envelope.scope)) throw new Error('Solicitud local de otra sesión, ruta o día.');
      return parseCustomerDeactivationResponse(envelope.result, stopId, true);
    },
  };
}
