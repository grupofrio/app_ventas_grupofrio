/**
 * F39 — check out every in-progress stop before liquidación / route close.
 *
 * A stop that is not the current cart is closed as a sale so a delivery that
 * already synced is not rewritten as no-sale. The current cart uses its real
 * total (0 → no-sale). Virtual stops never hit the checkout endpoint.
 */

import { checkOut } from './gfLogistics';
import { getCurrentPosition, setGpsMode } from './gps';
import { buildCheckoutPayload } from './checkoutResult';
import { stuckVisitSaleTotal } from './stuckVisitClose';
import { shouldSkipStopCheckout } from './virtualStops';
import { useRouteStore } from '../stores/useRouteStore';
import { useVisitStore } from '../stores/useVisitStore';
import { useLocationStore } from '../stores/useLocationStore';
import { createUuidV4 } from '../utils/clientEvent';
import type { CloseStopRef } from './routeClosePreconditions';

export interface InProgressCloseFailure {
  stopId: number;
  customerName: string;
  message: string;
}

export interface InProgressCloseResult {
  ok: boolean;
  closedIds: number[];
  failure: InProgressCloseFailure | null;
}

async function checkoutCoordinates(): Promise<{ latitude: number; longitude: number }> {
  const position = await getCurrentPosition();
  const latitude = position?.latitude ?? useLocationStore.getState().latitude ?? 0;
  const longitude = position?.longitude ?? useLocationStore.getState().longitude ?? 0;
  return { latitude, longitude };
}

function alreadyClosedMessage(message: string): boolean {
  return /already|ya (estaba |está |esta |fue )?(cerrad|visitad|finalizad|checkout)/i.test(message);
}

export async function checkoutInProgressStops(
  stops: readonly CloseStopRef[],
): Promise<InProgressCloseResult> {
  const closedIds: number[] = [];
  const { latitude, longitude } = stops.some((stop) => !shouldSkipStopCheckout(stop.id))
    ? await checkoutCoordinates()
    : { latitude: 0, longitude: 0 };

  for (const stop of stops) {
    const name = (stop.customer_name ?? '').trim() || `Parada ${stop.id}`;
    if (shouldSkipStopCheckout(stop.id)) {
      useRouteStore.getState().removeStop(stop.id);
      closedIds.push(stop.id);
      continue;
    }

    const currentStopId = useVisitStore.getState().currentStopId;
    const saleTotal = stuckVisitSaleTotal({
      currentStopId,
      stopId: stop.id,
      visitSaleTotal: useVisitStore.getState().saleTotal(),
    });
    const payload = buildCheckoutPayload({
      stopId: stop.id,
      latitude,
      longitude,
      saleTotal,
      noSaleReasonId: null,
    });
    const isCurrent = currentStopId === stop.id;
    try {
      await checkOut(
        payload.stop_id,
        payload.latitude,
        payload.longitude,
        payload.result_status,
        null,
        null,
        createUuidV4(),
        new Date().toISOString(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cerrar la visita.';
      if (!alreadyClosedMessage(message)) {
        return { ok: false, closedIds, failure: { stopId: stop.id, customerName: name, message } };
      }
    }

    useRouteStore.getState().updateStopState(stop.id, 'done');
    if (isCurrent) {
      useVisitStore.getState().resetVisit();
      setGpsMode('in_transit');
    }
    closedIds.push(stop.id);
  }

  return { ok: true, closedIds, failure: null };
}
