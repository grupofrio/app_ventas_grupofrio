import type { GFStop } from '../types/plan';
import type { VisitPhase } from '../stores/useVisitStore';
import {
  restoreSaleRecoveryIntent,
  type SaleRecoveryIntentV1,
} from './saleRecoveryIntent.ts';

export interface PersistedVisitSnapshot {
  phase: VisitPhase;
  currentStopId: number;
  currentStop: GFStop;
  offrouteVisitId: number | null;
  checkInTime: number;
  checkInLat: number | null;
  checkInLon: number | null;
  elapsedSeconds: number;
  // P0-2 (hardening): persist sale confirmation + idempotency key so a crash
  // after confirming a sale does NOT let the vendor re-confirm and create a
  // duplicate sale with a new operation_id on restart.
  saleConfirmed: boolean;
  saleOperationId: string | null;
  saleReadyToContinue: boolean;
  saleRecoveryPersistenceFailed: boolean;
  saleRecoveryIntent: SaleRecoveryIntentV1 | null;
}

export interface BuildVisitSnapshotInput {
  phase: VisitPhase;
  currentStopId: number | null;
  currentStop: GFStop | null;
  offrouteVisitId: number | null;
  checkInTime: number | null;
  checkInLat: number | null;
  checkInLon: number | null;
  elapsedSeconds: number;
  saleConfirmed?: boolean;
  saleOperationId?: string | null;
  saleReadyToContinue?: boolean;
  saleRecoveryPersistenceFailed?: boolean;
  saleRecoveryIntent?: unknown;
}

export function buildVisitSnapshot(input: BuildVisitSnapshotInput): PersistedVisitSnapshot | null {
  const {
    phase,
    currentStopId,
    currentStop,
    offrouteVisitId,
    checkInTime,
    checkInLat,
    checkInLon,
    elapsedSeconds,
    saleConfirmed = false,
    saleOperationId = null,
    saleReadyToContinue = false,
    saleRecoveryPersistenceFailed = false,
    saleRecoveryIntent = null,
  } = input;

  if (!['checked_in', 'selling', 'no_selling'].includes(phase)) return null;
  if (currentStopId == null || !currentStop || checkInTime == null) return null;

  const restoredIntent = restoreSaleRecoveryIntent(saleRecoveryIntent);
  const hasRecoverablePendingSale = saleConfirmed
    && !saleReadyToContinue
    && saleOperationId !== null
    && restoredIntent?.operationId === saleOperationId;
  const hasManualReviewLock = saleConfirmed
    && !saleReadyToContinue
    && typeof saleOperationId === 'string'
    && saleOperationId.trim().length > 0
    && restoredIntent === null
    && saleRecoveryPersistenceFailed;
  const hasTerminalSale = saleConfirmed && saleReadyToContinue;
  const persistConfirmed = hasRecoverablePendingSale || hasManualReviewLock || hasTerminalSale;

  return {
    phase,
    currentStopId,
    currentStop,
    offrouteVisitId,
    checkInTime,
    checkInLat,
    checkInLon,
    elapsedSeconds,
    saleConfirmed: persistConfirmed,
    saleOperationId: persistConfirmed ? saleOperationId : null,
    saleReadyToContinue: hasTerminalSale,
    saleRecoveryPersistenceFailed:
      hasManualReviewLock || (persistConfirmed && saleRecoveryPersistenceFailed),
    saleRecoveryIntent: hasRecoverablePendingSale ? restoredIntent : null,
  };
}

/**
 * Perf Fase 1B: decide si el tick del timer de visita debe persistir el
 * snapshot. Antes se escribía AsyncStorage CADA segundo; ahora solo cada
 * `intervalSeconds` (default 20). `elapsedSeconds` se recomputa de checkInTime
 * al rehidratar, así que entre snapshots no se pierde duración relevante.
 */
export function shouldPersistVisitTick(elapsedSeconds: number, intervalSeconds = 20): boolean {
  return Number.isFinite(elapsedSeconds)
    && elapsedSeconds > 0
    && intervalSeconds > 0
    && elapsedSeconds % intervalSeconds === 0;
}

export function shouldRehydrateVisit(
  snapshot: Pick<PersistedVisitSnapshot, 'currentStopId'> | null,
  stops: Array<Pick<GFStop, 'id' | 'state'>>,
): boolean {
  if (!snapshot) return false;
  const stop = stops.find((candidate) => candidate.id === snapshot.currentStopId);
  return stop?.state === 'in_progress';
}

export function shouldResetVisitAfterPlanRefresh(
  currentStopId: number | null,
  stops: Array<Pick<GFStop, 'id' | 'state'>>,
): boolean {
  if (currentStopId == null) return false;
  return !stops.some((candidate) => candidate.id === currentStopId);
}
