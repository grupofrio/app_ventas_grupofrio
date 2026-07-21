import type { GFStop } from '../types/plan';

export interface VisitDataState {
  phase: 'idle' | 'checked_in' | 'selling' | 'no_selling' | 'checked_out';
  currentStopId: number | null;
  currentStop: GFStop | null;
  offrouteVisitId: number | null;
  checkInTime: number | null;
  checkInLat: number | null;
  checkInLon: number | null;
  elapsedSeconds: number;
  saleLines: never[];
  salePaymentMethod: 'cash' | 'credit' | null;
  analyticPlazaId: number | null;
  analyticUnId: number | null;
  salePhotoTaken: boolean;
  salePhotoUri: string | null;
  salePhotoUris: string[];
  noSaleReasonId: number | null;
  noSaleReasonLabel: string;
  noSaleCompetitor: string | null;
  noSaleNotes: string;
  noSalePhotoTaken: boolean;
  noSalePhotoUri: string | null;
  noSalePhotoUris: string[];
  saleConfirmed: boolean;
  saleOperationId: string | null;
  saleReadyToContinue: boolean;
  saleRecoveryPersistenceFailed: boolean;
}

export interface PersistedSaleRecoveryState {
  saleConfirmed?: boolean;
  saleOperationId?: string | null;
  saleReadyToContinue?: boolean;
  saleRecoveryPersistenceFailed?: boolean;
}

export function restoreSaleReadyToContinue(
  snapshot: PersistedSaleRecoveryState,
): boolean {
  if (snapshot.saleReadyToContinue !== undefined) {
    return snapshot.saleReadyToContinue;
  }
  return snapshot.saleConfirmed === true && snapshot.saleOperationId === null;
}

export function restoreSaleRecoveryState(
  snapshot: PersistedSaleRecoveryState,
): Pick<
  VisitDataState,
  'saleConfirmed' | 'saleOperationId' | 'saleReadyToContinue' | 'saleRecoveryPersistenceFailed'
> {
  return {
    saleConfirmed: snapshot.saleConfirmed ?? false,
    saleOperationId: snapshot.saleOperationId ?? null,
    saleReadyToContinue: restoreSaleReadyToContinue(snapshot),
    saleRecoveryPersistenceFailed: snapshot.saleRecoveryPersistenceFailed ?? false,
  };
}

export function createInitialVisitState(): VisitDataState {
  return {
    phase: 'idle',
    currentStopId: null,
    currentStop: null,
    offrouteVisitId: null,
    checkInTime: null,
    checkInLat: null,
    checkInLon: null,
    elapsedSeconds: 0,
    saleLines: [],
    salePaymentMethod: null,
    analyticPlazaId: null,
    analyticUnId: null,
    salePhotoTaken: false,
    salePhotoUri: null,
    salePhotoUris: [],
    noSaleReasonId: null,
    noSaleReasonLabel: '',
    noSaleCompetitor: null,
    noSaleNotes: '',
    noSalePhotoTaken: false,
    noSalePhotoUri: null,
    noSalePhotoUris: [],
    saleConfirmed: false,
    saleOperationId: null,
    saleReadyToContinue: false,
    saleRecoveryPersistenceFailed: false,
  };
}

export function buildStartedVisitState(
  stop: GFStop,
  lat: number,
  lon: number,
  now = Date.now(),
): VisitDataState {
  return {
    ...createInitialVisitState(),
    phase: 'checked_in',
    currentStopId: stop.id,
    currentStop: stop,
    offrouteVisitId: stop._offrouteVisitId ?? null,
    checkInTime: now,
    checkInLat: lat,
    checkInLon: lon,
  };
}
