/**
 * Route plan and stop types.
 * From KOLD_FIELD_ADDENDUM.md Bloque 3 — GFPlan, GFStop.
 */

import { OdooId } from './odoo';
import { KoldScoreData, KoldForecastData } from './kold';

export type PlanState = 'draft' | 'confirmed' | 'published' | 'in_progress' | 'closed' | 'reconciled' | 'done';

export interface GFRouteLoadPicking {
  id?: number;
  picking_id?: number;
  name?: string;
  state?: string;
  origin?: string;
  scheduled_date?: string;
  location_id?: number;
  location_name?: string;
  location_dest_id?: number;
  location_dest_name?: string;
  accepted?: boolean;
  gf_route_load_accepted?: boolean;
  load_kind?: 'initial' | 'refill' | string;
  gf_route_load_kind?: 'initial' | 'refill' | string;
  lines?: GFRouteLoadLine[];
}

export interface GFRouteLoadLine {
  move_id?: number;
  product_id?: number;
  product_name?: string;
  requested_qty?: number;
  done_qty?: number;
  quantity?: number;
  display_qty?: number;
  uom_id?: number;
  uom_name?: string;
  state?: string;
}

export interface GFPlan {
  plan_id: OdooId;
  name: string;
  date: string; // "2026-03-25"
  state: PlanState;
  write_date?: string | null;
  demand_snapshot_hash?: string | null;
  route_plan_version?: string | null;
  route_plan_cache_ttl_seconds?: number | null;
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
  load_sealed?: boolean;
  load_picking_id?: number | false | null;
  load_pickings?: GFRouteLoadPicking[];
  pending_loads?: GFRouteLoadPicking[];
  pending_load_count?: number;
  has_pending_load?: boolean;
  corte_validated?: boolean;
  corte_validated_at?: string | null;
  liquidacion_done_at?: string | null;
  liquidacion_done_by?: string | null;
  // KM (Sprint C.1). Optional: present only if /my_plan serializes them.
  // Used to rehydrate the close hub's KM display across re-opens.
  departure_km?: number | null;
  arrival_km?: number | null;
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
  contact_name?: string;
  phone?: string;
  mobile?: string;
  email?: string;
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
