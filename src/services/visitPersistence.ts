import type { GFStop } from '../types/plan';
import type { VisitPhase } from '../stores/useVisitStore';
import {
  restoreSaleRecoveryIntent,
  type SaleRecoveryIntentV1,
} from './saleRecoveryIntent.ts';

export interface PersistedVisitSaleLine {
  productId: number;
  productName: string;
  price: number;
  priceConfirmation?: 'authorized' | 'pending_confirmation';
  qty: number;
  stock: number;
  weight: number;
}

export interface PersistedVisitSnapshot {
  phase: VisitPhase;
  currentStopId: number;
  currentStop: GFStop;
  offrouteVisitId: number | null;
  checkInTime: number;
  checkInLat: number | null;
  checkInLon: number | null;
  elapsedSeconds: number;
  saleLines: PersistedVisitSaleLine[];
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
  saleLines?: unknown;
  saleConfirmed?: boolean;
  saleOperationId?: string | null;
  saleReadyToContinue?: boolean;
  saleRecoveryPersistenceFailed?: boolean;
  saleRecoveryIntent?: unknown;
}

function normalizePersistedSaleLines(value: unknown): PersistedVisitSaleLine[] | null {
  if (!Array.isArray(value)) return null;
  const lines: PersistedVisitSaleLine[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return null;
    const line = candidate as Record<string, unknown>;
    if (
      typeof line.productId !== 'number'
      || !Number.isInteger(line.productId)
      || line.productId <= 0
      || typeof line.productName !== 'string'
      || typeof line.price !== 'number'
      || !Number.isFinite(line.price)
      || line.price < 0
      || typeof line.qty !== 'number'
      || !Number.isFinite(line.qty)
      || line.qty <= 0
      || typeof line.stock !== 'number'
      || !Number.isFinite(line.stock)
      || line.stock < 0
      || typeof line.weight !== 'number'
      || !Number.isFinite(line.weight)
      || line.weight < 0
      || (line.priceConfirmation !== undefined
        && line.priceConfirmation !== 'authorized'
        && line.priceConfirmation !== 'pending_confirmation')
    ) return null;
    lines.push({
      productId: line.productId,
      productName: line.productName,
      price: line.price,
      ...(line.priceConfirmation ? { priceConfirmation: line.priceConfirmation } : {}),
      qty: line.qty,
      stock: line.stock,
      weight: line.weight,
    });
  }
  return lines;
}

export function restorePersistedSaleLines(
  value: unknown,
  recoveryIntentValue?: unknown,
): PersistedVisitSaleLine[] {
  const direct = normalizePersistedSaleLines(value);
  if (direct !== null) return direct;

  const recoveryIntent = restoreSaleRecoveryIntent(recoveryIntentValue);
  if (!recoveryIntent) return [];
  return recoveryIntent.ticketSnapshot.lines.map((line) => ({
    productId: line.productId,
    productName: line.productName,
    price: line.unitPrice,
    ...(line.priceConfirmation ? { priceConfirmation: line.priceConfirmation } : {}),
    qty: line.qty,
    // Legacy snapshots did not preserve the reference stock. A confirmed
    // sale only needs a non-negative reference while checkout uses qty/price.
    stock: line.qty,
    weight: line.weight,
  }));
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
    saleLines,
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
    saleLines: restorePersistedSaleLines(saleLines, restoredIntent),
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
