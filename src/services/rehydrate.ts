/**
 * Rehydration service — restores app state on startup.
 *
 * Called once from _layout.tsx after auth check.
 * Loads persisted data back into Zustand stores.
 *
 * Order matters:
 * 1. Sync queue (so pending ops aren't lost)
 * 2. Route plan + stops
 * 3. KOLD intelligence (if cached)
 */

import { storeLoad, storeRemove, STORAGE_KEYS } from '../persistence/storage';
import { useSyncStore } from '../stores/useSyncStore';
import { useRouteStore } from '../stores/useRouteStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useVisitStore } from '../stores/useVisitStore';
import { useRouteStartStore } from '../stores/useRouteStartStore';
import { GFPlan, GFStop } from '../types/plan';
import { PersistedVisitSnapshot, shouldRehydrateVisit } from './visitPersistence';
import {
  dedupeActiveVirtualDrafts,
  stampMissingCreatedAt,
  pruneStaleVirtualDrafts,
  extractVirtualDrafts,
} from './offrouteDrafts';
// V2: Error persistence & periodic flush
import { loadPersistedErrors, startErrorPersistence } from '../utils/logger';
import { todayLocalISO } from '../utils/localDate';

export async function rehydrateAppState(): Promise<{
  queueSize: number;
  hasPlan: boolean;
  productCount: number;
}> {
  let queueSize = 0;
  let hasPlan = false;
  let productCount = 0;

  try {
    // 0. V2: Restore persisted error logs + start periodic flush
    await loadPersistedErrors();
    startErrorPersistence();

    // 1. Sync queue — CRITICAL: don't lose pending operations
    await useSyncStore.getState().rehydrateQueue();
    queueSize = useSyncStore.getState().pendingCount;

    // 1b. Route start readiness (Sprint A): checklist/km/load flags so the
    // hub doesn't show "no preparado" after an app restart.
    await useRouteStartStore.getState().hydrate();

    // 2. Route plan
    const plan = await storeLoad<GFPlan>(STORAGE_KEYS.PLAN);
    let stops = await storeLoad<GFStop[]>(STORAGE_KEYS.STOPS);

    // Garbage-collect stale offroute drafts on boot (see offrouteDrafts.ts
    // for the TTL) and stamp legacy drafts so the TTL can apply next time.
    if (stops && stops.length > 0) {
      const stamped = stampMissingCreatedAt(stops);
      const staleDraftIds = new Set(
        extractVirtualDrafts(stamped)
          .filter((d) => !pruneStaleVirtualDrafts([d]).length)
          .map((d) => d.id),
      );
      const withoutStale = staleDraftIds.size > 0
        ? stamped.filter((s) => !staleDraftIds.has(s.id))
        : stamped;
      stops = dedupeActiveVirtualDrafts(withoutStale);
    }

    if (plan && stops) {
      const today = todayLocalISO();
      const currentEmployeeId = useAuthStore.getState().employeeId;
      const isTodayPlan = plan.date === today;
      const isCurrentEmployeePlan = plan.driver_employee_id === currentEmployeeId;

      if (isTodayPlan && isCurrentEmployeePlan) {
        const completed = stops.filter((s) =>
          ['done', 'not_visited', 'no_stock', 'rejected', 'closed'].includes(s.state)
        ).length;
        const total = stops.length;

        useRouteStore.setState({
          plan,
          stops,
          stopsCompleted: completed,
          stopsTotal: total,
          progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
          lastSync: Date.now(),
        });
        hasPlan = true;

        const visitSnapshot = await storeLoad<PersistedVisitSnapshot>(STORAGE_KEYS.VISIT_STATE);
        if (shouldRehydrateVisit(visitSnapshot, stops)) {
          useVisitStore.getState().restoreVisit(visitSnapshot!);
        } else {
          await storeRemove(STORAGE_KEYS.VISIT_STATE);
        }
      } else {
        await Promise.all([
          storeRemove(STORAGE_KEYS.PLAN),
          storeRemove(STORAGE_KEYS.STOPS),
          storeRemove(STORAGE_KEYS.VISIT_STATE),
        ]);
      }
    } else {
      await storeRemove(STORAGE_KEYS.VISIT_STATE);
    }

    // 3. Products are intentionally not rehydrated. Inventory must come from
    // live Odoo stock so drivers do not sell against stale local quantities.
    await storeRemove(STORAGE_KEYS.PRODUCTS);

    console.log(
      `[rehydrate] Done: queue=${queueSize}, plan=${hasPlan}, products=${productCount}`
    );
  } catch (error) {
    console.error('[rehydrate] Error:', error);
  }

  return { queueSize, hasPlan, productCount };
}
