/**
 * Route plan and stop types.
 * From KOLD_FIELD_ADDENDUM.md Bloque 3 — GFPlan, GFStop.
 */

import { OdooId } from './odoo';
import { KoldScoreData, KoldForecastData } from './kold';

export type PlanState = 'draft' | 'confirmed' | 'in_progress' | 'done';

export interface GFPlan {
  plan_id: OdooId;
  name: string;
  date: string; // "2026-03-25"
  state: PlanState;
  route?: string;
  generation_mode?: string;
  selected_count?: number;
  eligible_count?: number;
  capacity_status?: string;
  driver_employee_id?: number;
  driver_employee_name?: string;
  warehouse_id?: number;
  warehouse_name?: string;
  // stock.location ID of the van's active location (gf.route.location_en_ruta_id).
  // Populated by backend when found=true. Required by the gift/transfer endpoints.
  // NOT the same as warehouse_id (which is stock.warehouse).
  mobile_location_id?: number | null;
  mobile_location_name?: string | null;
}

export type StopState =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'not_visited'
  | 'no_stock'
  | 'rejected'
  | 'closed';

export interface GFStop {
  id: OdooId;
  customer_id: number;
  customer_name: string;
  visit_line_id?: number | null;
  partner_id?: [number, string] | number | false | null;
  customer_ref?: string;
  customer_latitude?: number;
  customer_longitude?: number;
  google_maps_url?: string;
  state: StopState;
  route_sequence?: number;
  source_model: 'gf.route.stop';
  // Enriched client-side (not from API):
  _entityType?: 'customer' | 'lead';
  _isOffroute?: boolean;
  _leadId?: number | null;
  _partnerId?: number | null;
  _offrouteVisitId?: number | null;
  _pricelistId?: number | null;
  _pricelistName?: string | null;
  // Milliseconds since epoch. Stamped by addVirtualStop() so a plan
  // refresh can preserve in-flight offroute drafts without accumulating
  // orphaned entries forever — see offrouteDrafts.ts for the TTL.
  _virtualCreatedAt?: number;
  _koldScore?: KoldScoreData | null;
  _koldForecast?: KoldForecastData | null;
  _distanceMeters?: number;
  _geoFenceOk?: boolean;
}
