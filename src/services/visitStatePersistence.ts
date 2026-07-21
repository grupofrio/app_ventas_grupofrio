import { createSerializedTaskRunner } from './serializedTaskRunner.ts';
import type { SaleRecoveryIntentV1 } from './saleRecoveryIntent.ts';

export interface SaleRecoveryPersistenceState {
  saleConfirmed: boolean;
  saleOperationId: string | null;
  saleReadyToContinue: boolean;
  saleRecoveryPersistenceFailed: boolean;
  saleRecoveryIntent: SaleRecoveryIntentV1 | null;
}

export type SaleRecoveryPersistencePatch = Pick<
  SaleRecoveryPersistenceState,
  | 'saleConfirmed'
  | 'saleOperationId'
  | 'saleReadyToContinue'
  | 'saleRecoveryPersistenceFailed'
  | 'saleRecoveryIntent'
>;

interface VisitStatePersistenceOptions<
  State extends SaleRecoveryPersistenceState,
  Snapshot,
> {
  read: () => State;
  selectSnapshot: (state: State) => Snapshot | null;
  save: (snapshot: Snapshot) => Promise<void>;
  remove: () => Promise<void>;
  publishSaleRecovery: (patch: SaleRecoveryPersistencePatch) => void;
}

export interface VisitStatePersistenceCoordinator {
  persistCurrent: () => Promise<void>;
  persistSaleConfirmationLock: (
    operationId: string,
    intent: SaleRecoveryIntentV1,
  ) => Promise<boolean>;
  markSaleReadyToContinue: (
    operationId: string,
    options?: { clearOperationId?: boolean },
  ) => Promise<boolean>;
  clearSaleConfirmationLock: (operationId: string) => Promise<boolean>;
}

export function createVisitStatePersistenceCoordinator<
  State extends SaleRecoveryPersistenceState,
  Snapshot,
>(options: VisitStatePersistenceOptions<State, Snapshot>): VisitStatePersistenceCoordinator {
  const runSerialized = createSerializedTaskRunner();

  return {
    persistCurrent(): Promise<void> {
      return runSerialized(async () => {
        const snapshot = options.selectSnapshot(options.read());
        if (snapshot === null) {
          await options.remove();
          return;
        }
        await options.save(snapshot);
      });
    },

    persistSaleConfirmationLock(
      operationId: string,
      intent: SaleRecoveryIntentV1,
    ): Promise<boolean> {
      return runSerialized(async () => {
        const current = options.read();
        if (
          !current.saleConfirmed
          || current.saleOperationId !== operationId
          || current.saleReadyToContinue
        ) {
          return false;
        }
        if (intent.operationId !== operationId) return false;

        const patch: SaleRecoveryPersistencePatch = {
          saleConfirmed: true,
          saleOperationId: operationId,
          saleReadyToContinue: false,
          saleRecoveryPersistenceFailed: false,
          saleRecoveryIntent: intent,
        };
        const snapshot = options.selectSnapshot({ ...current, ...patch });
        if (snapshot === null) {
          throw new Error('Confirmed sale does not have an active visit snapshot');
        }
        await options.save(snapshot);

        const latest = options.read();
        const stillCurrent = latest.saleConfirmed
          && latest.saleOperationId === operationId
          && !latest.saleReadyToContinue;
        if (!stillCurrent) return false;
        options.publishSaleRecovery(patch);
        return true;
      });
    },

    markSaleReadyToContinue(
      operationId: string,
      markerOptions?: { clearOperationId?: boolean },
    ): Promise<boolean> {
      return runSerialized(async () => {
        const current = options.read();
        if (!current.saleConfirmed || current.saleOperationId !== operationId) {
          return false;
        }

        const patch: SaleRecoveryPersistencePatch = {
          saleConfirmed: true,
          saleOperationId: markerOptions?.clearOperationId ? null : operationId,
          saleReadyToContinue: true,
          saleRecoveryPersistenceFailed: false,
          saleRecoveryIntent: null,
        };
        const snapshot = options.selectSnapshot({ ...current, ...patch });
        if (snapshot === null) {
          throw new Error('Confirmed sale does not have an active visit snapshot');
        }

        await options.save(snapshot);

        const latest = options.read();
        if (!latest.saleConfirmed || latest.saleOperationId !== operationId) {
          return false;
        }
        options.publishSaleRecovery(patch);
        return true;
      });
    },

    clearSaleConfirmationLock(operationId: string): Promise<boolean> {
      return runSerialized(async () => {
        const current = options.read();
        if (!current.saleConfirmed || current.saleOperationId !== operationId) {
          return false;
        }

        const patch: SaleRecoveryPersistencePatch = {
          saleConfirmed: false,
          saleOperationId: null,
          saleReadyToContinue: false,
          saleRecoveryPersistenceFailed: false,
          saleRecoveryIntent: null,
        };
        const snapshot = options.selectSnapshot({ ...current, ...patch });
        if (snapshot === null) {
          await options.remove();
        } else {
          await options.save(snapshot);
        }

        const latest = options.read();
        if (!latest.saleConfirmed || latest.saleOperationId !== operationId) {
          return false;
        }
        options.publishSaleRecovery(patch);
        return true;
      });
    },
  };
}
