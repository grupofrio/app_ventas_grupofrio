/**
 * Binds a crm.lead created from the field queue onto the visit the seller
 * already opened. Kept out of the sync store's static imports so the route
 * store and the queue do not initialize each other.
 */

import { useAuthStore } from '../stores/useAuthStore';
import { useRouteStore } from '../stores/useRouteStore';
import { useVisitStore } from '../stores/useVisitStore';
import { startOffrouteVisit } from './gfLogistics';
import { extractOffrouteVisitId } from './offrouteVisit';
import { pendingLeadVisitPatches } from './sellerProspectVisit';

const DEFAULT_FIELD_COMPANY_ID = 34;

export async function bindCreatedFieldLeadVisit(
  operationId: string,
  leadId: number,
  options: { online: boolean },
): Promise<void> {
  const route = useRouteStore.getState();
  const patches = pendingLeadVisitPatches(route.stops, operationId, leadId);
  for (const item of patches) {
    route.patchStop(item.id, item.patch);
  }

  const visit = useVisitStore.getState();
  if (visit.currentStop?._pendingLeadOperationId === operationId) {
    useVisitStore.setState({
      currentStop: {
        ...visit.currentStop,
        _leadId: leadId,
        _pendingLeadOperationId: null,
        customer_id: visit.currentStop.customer_id > 0 ? visit.currentStop.customer_id : leadId,
      },
    });
  }

  if (!options.online) return;

  const bound = useRouteStore.getState().stops.find((stop) => (
    stop._leadId === leadId && stop._isOffroute && !stop._offrouteVisitId
  ));
  if (!bound) return;

  try {
    const companyId = useAuthStore.getState().companyId;
    const started = await startOffrouteVisit({
      partner_id: null,
      lead_id: leadId,
      company_id: companyId ?? DEFAULT_FIELD_COMPANY_ID,
      latitude: bound.customer_latitude,
      longitude: bound.customer_longitude,
    });
    const offrouteVisitId = extractOffrouteVisitId(
      started && typeof started.id === 'number' ? started.id : null,
    );
    if (!offrouteVisitId) return;
    useRouteStore.getState().patchStop(bound.id, { _offrouteVisitId: offrouteVisitId });
    if (useVisitStore.getState().currentStopId === bound.id) {
      useVisitStore.getState().setOffrouteVisitId(offrouteVisitId);
    }
  } catch {
    // The local visit stays. Conversion can use the lead id once it is bound.
  }
}
