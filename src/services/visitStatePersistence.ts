import { createSerializedTaskRunner } from './serializedTaskRunner.ts';

export interface SaleRecoveryPersistenceState {
  saleConfirmed: boolean;
  saleOperationId: string | null;
  saleReadyToContinue: boolean;
  saleRecoveryPersistenceFailed: boolean;
}

export type SaleRecoveryPersistencePatch = Pick<
  SaleRecoveryPersistenceState,
  'saleOperationId' | 'saleReadyToContinue' | 'saleRecoveryPersistenceFailed'
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
  markSaleReadyToContinue: (
    operationId: string,
    options?: { clearOperationId?: boolean },
  ) => Promise<boolean>;
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
          saleOperationId: markerOptions?.clearOperationId ? null : operationId,
          saleReadyToContinue: true,
          saleRecoveryPersistenceFailed: false,
        };
        const snapshot = options.selectSnapshot({ ...current, ...patch });
        if (snapshot === null) {
          throw new Error('Confirmed sale does not have an active visit snapshot');
        }

        await options.save(snapshot);

        const latest = options.read();
        if (latest.saleConfirmed && latest.saleOperationId === operationId) {
          options.publishSaleRecovery(patch);
        }
        return true;
      });
    },
  };
}
