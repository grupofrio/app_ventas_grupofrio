/**
 * GF Logistics REST API endpoints.
 *
 * IMPORTANT: These are REST endpoints (gf_logistics_ops module), NOT JSON-RPC.
 * They expect plain payloads like { stop_id: 123, latitude: ... }.
 * Checkout now also sends result_status so Odoo can close the stop.
 * Do NOT wrap with jsonrpc/params — that causes 400 errors.
 *
 * For Odoo JSON-RPC endpoints (/jsonrpc, /get_records, /api/create_update),
 * use odooRpc.ts or postRpc() from api.ts instead.
 *
 * Reference: useSyncStore.ts uses these same endpoints with plain payloads
 * and works correctly in production.
 */

import { postRest, DEFAULT_READ_TIMEOUT_MS } from './api';
import { GFPlan, GFStop } from '../types/plan';
import {
  classifyRouteLoadError,
  isAccessDeniedMessage,
  backendMessageOf,
  type RouteLoadStatus,
} from './routeLoadOutcome';
import { CheckoutResultStatus } from './checkoutResult';
// BLD-008: optional client event metadata. Feature-flagged inside the
// helper — safe to pass from anywhere.
import { ClientEventMeta, attachClientMetaToRestPayload } from '../utils/clientEvent';
import { logInfo, logWarn } from '../utils/logger';
import { buildExchangeCreatePayload } from './gfLogisticsContracts';
import { buildRouteLoadAcceptPayload } from './routeLoadAcceptance';
import { isAlreadyConfirmedResponse } from './idempotentResponse';
import { normalizePlanStopPayload } from './planStopPayload';
import { todayLocalISO } from '../utils/localDate';
import { fetchMyPlan } from './routePlanRefresh';

const GF_BASE = 'gf/logistics/api/employee';

export interface StartPlanResult {
  planId: number;
  state: 'in_progress';
}

export interface GFSalesSummary {
  date: string;
  orders_count: number;
  sales_amount_total: number;
  amount_untaxed_total: number;
  amount_tax_total: number;
  kg_total: number;
  avg_ticket: number;
  monthly_target: number;
  monthly_achieved: number;
  cash_amount_total: number;
  credit_amount_total: number;
}

export interface GFSalesOrderLine {
  product_id: number;
  product_name: string;
  quantity: number;
  price_unit: number;
  price_subtotal: number;
  kg_total: number;
}

export interface GFSalesOrder {
  id: number;
  name: string;
  partner_id: number | null;
  partner_name: string;
  amount_total: number;
  amount_untaxed: number;
  amount_tax: number;
  kg_total: number;
  state: string;
  date_order: string;
  confirmation_date: string;
  stop_id: number | null;
  operation_id: string;
  payment_method: string;
  payment_method_label: string;
  employee_name: string;
  lines: GFSalesOrderLine[];
}

export interface GFSalesListResult {
  count: number;
  orders: GFSalesOrder[];
}

export interface GFExchangeResult {
  exchange_id: number | null;
  exchange_name: string;
  picking_delivery_id: number | null;
  picking_merma_id: number | null;
  state: string;
}

export interface GFExchangeResponse {
  user_message: string;
  data: GFExchangeResult;
}

// ─── Liquidation summary (BLD-20260427-P1-CASHCLOSE-LIQUIDATION) ─────────────
// Backend: gf_logistics_ops controllers/gf_api.py POST /pwa-ruta/liquidation
//          (handler _handle_liquidation → gf.route.plan.build_liquidation_summary)
// El endpoint suma account.payment por bucket (cash/credit/transfer) sobre el
// plan del día. Es la fuente de verdad para Cash Close porque /sales/summary
// devuelve cash_amount_total y credit_amount_total HARDCODED a 0.0
// (ver sale_order.py L256-257 en el snapshot de gf_logistics_ops).

export interface GFLiquidationPaymentBucket {
  count: number;
  total: number;
}

export interface GFLiquidationPaymentDetail {
  payment_id: number;
  stop_id: number | null;
  stop_name: string;
  amount: number;
  method: string; // 'cash' | 'credit' | 'transfer' | otros si Sebas agrega
  state: string;
}

export interface GFLiquidationSummary {
  plan_id: number;
  plan_name: string;
  expected_payments: {
    cash: GFLiquidationPaymentBucket;
    credit: GFLiquidationPaymentBucket;
    transfer: GFLiquidationPaymentBucket;
  };
  payments: {
    cash: GFLiquidationPaymentBucket;
    credit: GFLiquidationPaymentBucket;
    transfer: GFLiquidationPaymentBucket;
  };
  total_collected: number;
  total_expected: number;
  payment_details: GFLiquidationPaymentDetail[];
  include_draft: boolean;
}

export interface GFRouteReconciliationLine {
  id: number;
  product_id: number;
  product_name: string;
  qty_loaded: number;
  qty_delivered: number;
  qty_returned: number;
  qty_scrap: number;
  qty_difference: number;
}

export interface GFRouteReconciliation {
  reconciliation_id: number;
  state: string;
  qty_loaded: number;
  qty_delivered: number;
  qty_returned: number;
  qty_scrap: number;
  qty_difference: number;
  lines: GFRouteReconciliationLine[];
}

export interface GFRouteCorteResult {
  ok: boolean;
  success: boolean;
  code?: string;
  message: string;
  data?: Record<string, unknown> | null;
}

export interface GFRouteCorteAdjustmentLine {
  product_id: number;
  return_qty: number;
  scrap_qty: number;
}

export interface GFRouteCorteAdjustmentResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown> | null;
}

export interface GFRouteLiquidationConfirmResult {
  ok: boolean;
  code?: string;
  message: string;
  data?: {
    plan_id?: number;
    liquidacion_done_at?: string;
    liquidacion_done_by?: string;
    liquidacion_notes?: string;
    total_collected?: number;
    total_expected?: number;
    difference?: number;
    force?: boolean;
    route_close_warning?: string | null;
  } | null;
}

const EMPTY_LIQUIDATION_SUMMARY: GFLiquidationSummary = {
  plan_id: 0,
  plan_name: '',
  expected_payments: {
    cash: { count: 0, total: 0 },
    credit: { count: 0, total: 0 },
    transfer: { count: 0, total: 0 },
  },
  payments: {
    cash: { count: 0, total: 0 },
    credit: { count: 0, total: 0 },
    transfer: { count: 0, total: 0 },
  },
  total_collected: 0,
  total_expected: 0,
  payment_details: [],
  include_draft: false,
};

const EMPTY_ROUTE_RECONCILIATION: GFRouteReconciliation = {
  reconciliation_id: 0,
  state: '',
  qty_loaded: 0,
  qty_delivered: 0,
  qty_returned: 0,
  qty_scrap: 0,
  qty_difference: 0,
  lines: [],
};

const EMPTY_SALES_SUMMARY: GFSalesSummary = {
  date: '',
  orders_count: 0,
  sales_amount_total: 0,
  amount_untaxed_total: 0,
  amount_tax_total: 0,
  kg_total: 0,
  avg_ticket: 0,
  monthly_target: 0,
  monthly_achieved: 0,
  cash_amount_total: 0,
  credit_amount_total: 0,
};

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toNullablePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function unwrapEnvelope<T>(result: unknown): T | null {
  if (!result || typeof result !== 'object') return null;
  const payload = result as Record<string, unknown>;
  return (payload.data !== undefined ? payload.data : payload) as T;
}

function normalizeSalesSummary(result: unknown): GFSalesSummary {
  const data = unwrapEnvelope<Record<string, unknown>>(result) ?? {};
  return {
    date: typeof data.date === 'string' ? data.date : '',
    orders_count: toNumber(data.orders_count),
    sales_amount_total: toNumber(data.sales_amount_total),
    amount_untaxed_total: toNumber(data.amount_untaxed_total),
    amount_tax_total: toNumber(data.amount_tax_total),
    kg_total: toNumber(data.kg_total),
    avg_ticket: toNumber(data.avg_ticket),
    monthly_target: toNumber(data.monthly_target),
    monthly_achieved: toNumber(data.monthly_achieved),
    cash_amount_total: toNumber(data.cash_amount_total),
    credit_amount_total: toNumber(data.credit_amount_total),
  };
}

function normalizeSalesList(result: unknown): GFSalesListResult {
  const data = unwrapEnvelope<Record<string, unknown>>(result) ?? {};
  const ordersRaw = Array.isArray(data.orders) ? data.orders : [];

  return {
    count: toNumber(data.count),
    orders: ordersRaw.map((row) => {
      const order = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      const linesRaw = Array.isArray(order.lines) ? order.lines : [];
      return {
        id: toNumber(order.id),
        name: typeof order.name === 'string' ? order.name : '',
        partner_id: toNullablePositiveNumber(order.partner_id),
        partner_name: typeof order.partner_name === 'string' ? order.partner_name : '',
        amount_total: toNumber(order.amount_total),
        amount_untaxed: toNumber(order.amount_untaxed),
        amount_tax: toNumber(order.amount_tax),
        kg_total: toNumber(order.kg_total),
        state: typeof order.state === 'string' ? order.state : '',
        date_order: typeof order.date_order === 'string' ? order.date_order : '',
        confirmation_date: typeof order.confirmation_date === 'string' ? order.confirmation_date : '',
        stop_id: toNullablePositiveNumber(order.stop_id),
        operation_id: typeof order.operation_id === 'string' ? order.operation_id : '',
        payment_method: typeof order.payment_method === 'string' ? order.payment_method : '',
        payment_method_label: typeof order.payment_method_label === 'string' ? order.payment_method_label : '',
        employee_name: typeof order.employee_name === 'string' ? order.employee_name : '',
        lines: linesRaw.map((row) => {
          const line = row && typeof row === 'object' ? row as Record<string, unknown> : {};
          return {
            product_id: toNumber(line.product_id),
            product_name: typeof line.product_name === 'string' ? line.product_name : '',
            quantity: toNumber(line.quantity ?? line.qty),
            price_unit: toNumber(line.price_unit),
            price_subtotal: toNumber(line.price_subtotal ?? line.subtotal),
            kg_total: toNumber(line.kg_total ?? line.weight_total),
          };
        }),
      };
    }),
  };
}

function normalizeExchangeResponse(result: unknown): GFExchangeResponse {
  const payload = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const data = payload.data && typeof payload.data === 'object'
    ? payload.data as Record<string, unknown>
    : {};

  return {
    user_message: typeof payload.user_message === 'string' && payload.user_message.trim().length > 0
      ? payload.user_message
      : 'Cambio procesado',
    data: {
      exchange_id: toNullablePositiveNumber(data.exchange_id),
      exchange_name: typeof data.exchange_name === 'string' ? data.exchange_name : '',
      picking_delivery_id: toNullablePositiveNumber(data.picking_delivery_id),
      picking_merma_id: toNullablePositiveNumber(data.picking_merma_id),
      state: typeof data.state === 'string' ? data.state : '',
    },
  };
}

// ═══ Plan & Route ═══

function getMyPlanDate(): string {
  const qaRouteDate = (process.env as Record<string, string | undefined>)[
    'EXPO_PUBLIC_KF_QA_ROUTE_DATE'
  ]?.trim();

  if (qaRouteDate && /^\d{4}-\d{2}-\d{2}$/.test(qaRouteDate)) {
    return qaRouteDate;
  }

  return todayLocalISO();
}

export async function getMyPlan(): Promise<GFPlan | null> {
  // PR-2: cargar el plan es una LECTURA — usar el timeout corto (10s), no el de
  // mutación (45s). Antes, en WiFi congestionado del CEDIS el operador esperaba
  // 45s antes de ver el error. fetchMyPlan lanza en error de red/servidor y solo
  // devuelve null cuando el backend dice found:false (ausencia real de plan).
  return fetchMyPlan(
    (url, data) => postRest(url, data, { timeoutMs: DEFAULT_READ_TIMEOUT_MS }),
    `${GF_BASE}/my_plan`,
    getMyPlanDate(),
  );
}

export async function startPlan(planId: number): Promise<StartPlanResult> {
  const result = await postRest<any>(`${GF_BASE}/plan/start`, { plan_id: planId });
  const data = result?.data ?? result;
  if (Number(data?.plan_id) !== planId || data?.state !== 'in_progress') {
    throw new Error('Odoo no confirmó el inicio de la ruta.');
  }
  return { planId, state: 'in_progress' };
}

export interface PlanStopsResult {
  /** 'ok' | 'access_denied' | 'stops_error' | 'timeout' | 'network_error' | 'server_error' | 'invalid_response' */
  status: RouteLoadStatus;
  stops: GFStop[];
  /** Mensaje del backend si lo hay (p.ej. motivo de acceso denegado). */
  message: string | null;
}

/**
 * PR-2: variante discriminada de getPlanStops. En vez de tragar TODO fallo a
 * `[]` (que produce "ruta vacía silenciosa"), devuelve el motivo real —
 * access_denied / timeout / network / server / invalid — para que la UI
 * distinga "plan sin paradas" de "no pudimos cargar las paradas".
 */
export async function getPlanStopsResult(planId: number): Promise<PlanStopsResult> {
  try {
    // Lectura: timeout corto (10s), no el de mutación (45s).
    // BLD-20260405-021: backend envuelve en { ok, message, data:{ stops:[...] }}.
    // Soportamos ambas formas (envuelta y array pelado) por compatibilidad.
    const result = await postRest<any>(
      `${GF_BASE}/plan/stops`,
      { plan_id: planId },
      { timeoutMs: DEFAULT_READ_TIMEOUT_MS },
    );

    // ok:false → NO ocultar: clasificar acceso denegado vs fallo de stops.
    if (result && typeof result === 'object' && !Array.isArray(result) && result.ok === false) {
      const message = typeof result.message === 'string' ? result.message : null;
      const status: RouteLoadStatus = isAccessDeniedMessage(message) ? 'access_denied' : 'stops_error';
      logWarn('general', 'plan_stops_access_denied', {
        endpoint: 'gf/logistics/api/employee/plan/stops',
        plan_id: planId,
        message,
        status,
        note: 'No se cargaron stops por respuesta ok:false del backend.',
      });
      return { status, stops: [], message };
    }

    const pickStops = (): any[] => {
      if (Array.isArray(result)) return result as any[];
      if (!result || typeof result !== 'object') return [];
      const data = result.data !== undefined ? result.data : result;
      if (data && Array.isArray(data.stops)) return data.stops as any[];
      if (Array.isArray(data)) return data as any[];
      return [];
    };

    const rawStops = pickStops();

    // Log de muestreo de campos de stops (diagnóstico lead/customer).
    try {
      logInfo('general', 'plan_stops_sample', {
        plan_id: planId,
        count: rawStops.length,
        sample: rawStops.slice(0, 3).map((s: any) => ({
          id: s?.id,
          _entityType: s?._entityType,
          _leadId: s?._leadId,
          _partnerId: s?._partnerId,
          customer_id: s?.customer_id,
          pricelist_id: s?.pricelist_id,
          _pricelistId: s?._pricelistId,
        })),
      });
    } catch {
      // logger defensivo: nunca debe romper el plan
    }

    const stops = rawStops
      .filter((stop): stop is Record<string, unknown> => !!stop && typeof stop === 'object')
      .map(normalizePlanStopPayload);
    return { status: 'ok', stops, message: null };
  } catch (error) {
    // Clasificar el fallo real (timeout/red/servidor/invalid) — antes se
    // colapsaba a [] y se perdía la causa para la UI.
    const classified = classifyRouteLoadError(error);
    const status: RouteLoadStatus = classified === 'unknown_error' ? 'stops_error' : classified;
    logWarn('general', 'plan_stops_request_failed', {
      endpoint: 'gf/logistics/api/employee/plan/stops',
      plan_id: planId,
      status,
      message: error instanceof Error ? error.message : String(error),
    });
    return { status, stops: [], message: backendMessageOf(error) };
  }
}

/** Compat: devuelve solo el array de paradas (callers que no necesitan el motivo). */
export async function getPlanStops(planId: number): Promise<GFStop[]> {
  return (await getPlanStopsResult(planId)).stops;
}

// ═══ Stop Operations ═══

export async function checkIn(
  stopId: number,
  latitude: number,
  longitude: number,
  meta?: ClientEventMeta | null,
): Promise<boolean> {
  const payload = attachClientMetaToRestPayload(
    { stop_id: stopId, latitude, longitude },
    meta ?? null,
  );
  const result = await postRest<{ success: boolean }>(`${GF_BASE}/stop/checkin`, payload);
  return !!result;
}

export async function checkOut(
  stopId: number,
  latitude: number,
  longitude: number,
  resultStatus: CheckoutResultStatus,
  meta?: ClientEventMeta | null,
): Promise<boolean> {
  const payload = attachClientMetaToRestPayload(
    { stop_id: stopId, latitude, longitude, result_status: resultStatus },
    meta ?? null,
  );
  const result = await postRest<{ success: boolean }>(`${GF_BASE}/stop/checkout`, payload);
  return !!result;
}

export async function getStopLines(stopId: number): Promise<unknown[]> {
  try {
    const result = await postRest<unknown[]>(`${GF_BASE}/stop/lines`, {
      stop_id: stopId,
    });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

export async function reportIncident(
  stopId: number,
  incidentTypeId: number,
  notes: string,
  meta?: ClientEventMeta | null,
): Promise<boolean> {
  const payload = attachClientMetaToRestPayload(
    { stop_id: stopId, incident_type_id: incidentTypeId, notes },
    meta ?? null,
  );
  const result = await postRest<{ success: boolean }>(`${GF_BASE}/stop/incidents`, payload);
  return !!result;
}

export async function uploadStopImage(
  stopId: number,
  imageBase64: string,
  imageType: string = 'visit',
  meta?: ClientEventMeta | null,
): Promise<boolean> {
  const payload = attachClientMetaToRestPayload(
    { stop_id: stopId, image_base64: imageBase64, image_type: imageType },
    meta ?? null,
  );
  const result = await postRest<{ success: boolean }>(`${GF_BASE}/stop/images`, payload);
  return !!result;
}

// ═══ Sales & Payments (gf_logistics_ops) ═══
//
// Replaces the legacy `/api/create_update` path over `sale.order` /
// `account.payment`, which required ACLs the driver user doesn't have
// and had no server-side tolerance for obsolete stop_id.
//
// Backend contract (already deployed):
//   POST /gf/logistics/api/employee/sales/create
//     Body:  { operation_id|x_operation_id, partner_id, lines,
//              stop_id?, warehouse_id?, pricelist_id?, create_invoice?,
//              note?, _client_meta? }
//     Line:  { product_id, quantity, price_unit?, discount? }
//
//   POST /gf/logistics/api/employee/payments/create
//     Body:  { operation_id|x_operation_id, amount,
//              sale_order_id|partner_id, payment_method_line_id?,
//              stop_id?, journal_id?, payment_date?, reference?, currency_id? }

export async function createSale(
  payload: Record<string, unknown>,
  meta?: ClientEventMeta | null,
): Promise<boolean> {
  const body = attachClientMetaToRestPayload(payload, meta ?? null);
  const result = await postRest<{ success?: boolean }>(
    `${GF_BASE}/sales/create`,
    body,
  );
  return !!result;
}

export async function acceptRouteLoad(routePlanId: number, pickingId: number): Promise<boolean> {
  const result = await postRest<{ ok?: boolean; success?: boolean }>(
    `${GF_BASE}/route_plan/seal_load`,
    buildRouteLoadAcceptPayload(routePlanId, pickingId),
  );
  return result?.ok === true || result?.success === true || !!result;
}

export async function createPayment(
  payload: Record<string, unknown>,
  meta?: ClientEventMeta | null,
): Promise<boolean> {
  const body = attachClientMetaToRestPayload(payload, meta ?? null);
  const result = await postRest<{ success?: boolean }>(
    `${GF_BASE}/payments/create`,
    body,
  );
  return !!result;
}

export async function createExchange(
  payload: Record<string, unknown>,
  meta?: ClientEventMeta | null,
): Promise<GFExchangeResponse> {
  const contractPayload = buildExchangeCreatePayload(payload);
  const body = attachClientMetaToRestPayload(contractPayload, meta ?? null);
  // NOTE: este endpoint vive en gf/salesops, NOT en gf/logistics/api/employee.
  const result = await postRest<any>(
    'gf/salesops/exchange/create',
    body,
  );
  return normalizeExchangeResponse(result);
}

export async function fetchSalesSummary(
  payload: { date?: string } = {},
): Promise<GFSalesSummary> {
  const body: Record<string, unknown> = {};
  if (typeof payload.date === 'string' && payload.date.trim().length > 0) {
    body.date = payload.date.trim();
  }

  const result = await postRest<any>(`${GF_BASE}/sales/summary`, body);
  return normalizeSalesSummary(result) ?? EMPTY_SALES_SUMMARY;
}

export async function fetchSalesList(
  payload: { date?: string; limit?: number; offset?: number } = {},
): Promise<GFSalesListResult> {
  const body: Record<string, unknown> = {};
  if (typeof payload.date === 'string' && payload.date.trim().length > 0) {
    body.date = payload.date.trim();
  }
  if (typeof payload.limit === 'number' && payload.limit > 0) {
    body.limit = payload.limit;
  }
  if (typeof payload.offset === 'number' && payload.offset >= 0) {
    body.offset = payload.offset;
  }

  const result = await postRest<any>(`${GF_BASE}/sales/list`, body);
  return normalizeSalesList(result);
}

// ─── Liquidation summary (read-only) ────────────────────────────────────────
//
// Endpoint:    POST /pwa-ruta/liquidation
// Backend:     gf_logistics_ops controllers/gf_api.py L3241
// Handler:     _handle_liquidation → gf.route.plan.build_liquidation_summary
// Auth:        public + employee_token (resuelto por _run_with_session_employee)
//
// Por qué este endpoint y no /sales/summary:
//   /sales/summary devuelve cash_amount_total y credit_amount_total HARDCODED
//   a 0.0 (sale_order.py L256-257 en snapshot gf_logistics_ops). Para Cash
//   Close necesitamos los buckets reales sumados desde account.payment, que
//   solo provee build_liquidation_summary().
//
// IMPORTANTE: este wrapper es SÓLO LECTURA. NO mutar.
//   Para confirmar liquidación se usaría /pwa-ruta/liquidacion-confirm,
//   pero eso queda fuera de scope hasta verificar deploy en producción.
function normalizeLiquidationBucket(value: unknown): GFLiquidationPaymentBucket {
  if (!value || typeof value !== 'object') return { count: 0, total: 0 };
  const bucket = value as Record<string, unknown>;
  return {
    count: toNumber(bucket.count),
    total: toNumber(bucket.total),
  };
}

function normalizeLiquidationSummary(result: unknown): GFLiquidationSummary {
  const data = unwrapEnvelope<Record<string, unknown>>(result);
  if (!data) return EMPTY_LIQUIDATION_SUMMARY;

  const expectedRaw = data.expected_payments && typeof data.expected_payments === 'object'
    ? data.expected_payments as Record<string, unknown>
    : {};
  const paymentsRaw = data.payments && typeof data.payments === 'object'
    ? data.payments as Record<string, unknown>
    : {};

  const detailsRaw = Array.isArray(data.payment_details) ? data.payment_details : [];

  return {
    plan_id: toNumber(data.plan_id),
    plan_name: typeof data.plan_name === 'string' ? data.plan_name : '',
    expected_payments: {
      cash: normalizeLiquidationBucket(expectedRaw.cash),
      credit: normalizeLiquidationBucket(expectedRaw.credit),
      transfer: normalizeLiquidationBucket(expectedRaw.transfer),
    },
    payments: {
      cash: normalizeLiquidationBucket(paymentsRaw.cash),
      credit: normalizeLiquidationBucket(paymentsRaw.credit),
      transfer: normalizeLiquidationBucket(paymentsRaw.transfer),
    },
    total_collected: toNumber(data.total_collected),
    total_expected: toNumber(data.total_expected),
    payment_details: detailsRaw.map((row) => {
      const detail = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      return {
        payment_id: toNumber(detail.payment_id),
        stop_id: toNullablePositiveNumber(detail.stop_id),
        stop_name: typeof detail.stop_name === 'string' ? detail.stop_name : '',
        amount: toNumber(detail.amount),
        method: typeof detail.method === 'string' ? detail.method : '',
        state: typeof detail.state === 'string' ? detail.state : '',
      };
    }),
    include_draft: Boolean(data.include_draft),
  };
}

export async function fetchLiquidationSummary(
  payload: { plan_id?: number; include_draft?: boolean } = {},
): Promise<GFLiquidationSummary> {
  const body: Record<string, unknown> = {};
  if (typeof payload.plan_id === 'number' && payload.plan_id > 0) {
    body.plan_id = payload.plan_id;
  }
  if (typeof payload.include_draft === 'boolean') {
    body.include_draft = payload.include_draft;
  }

  // pwa-ruta/liquidation usa base distinta a GF_BASE (gf/logistics/api/employee).
  // postRest acepta path relativo desde base URL — la slash inicial NO aplica
  // porque buildAbsoluteUrl ya la limpia.
  const result = await postRest<unknown>('pwa-ruta/liquidation', body);
  return normalizeLiquidationSummary(result);
}

export function getLiquidationExpectedCashTotal(summary: GFLiquidationSummary | null | undefined): number {
  if (!summary) return 0;
  return summary.expected_payments.cash.total;
}

function normalizeRouteReconciliation(result: unknown): GFRouteReconciliation {
  const data = unwrapEnvelope<Record<string, unknown>>(result);
  if (!data) return EMPTY_ROUTE_RECONCILIATION;

  const linesRaw = Array.isArray(data.lines) ? data.lines : [];
  return {
    reconciliation_id: toNumber(data.reconciliation_id),
    state: typeof data.state === 'string' ? data.state : '',
    qty_loaded: toNumber(data.qty_loaded),
    qty_delivered: toNumber(data.qty_delivered),
    qty_returned: toNumber(data.qty_returned),
    qty_scrap: toNumber(data.qty_scrap),
    qty_difference: toNumber(data.qty_difference),
    lines: linesRaw.map((row) => {
      const line = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      return {
        id: toNumber(line.id),
        product_id: toNumber(line.product_id),
        product_name: typeof line.product_name === 'string' ? line.product_name : '',
        qty_loaded: toNumber(line.qty_loaded),
        qty_delivered: toNumber(line.qty_delivered),
        qty_returned: toNumber(line.qty_returned),
        qty_scrap: toNumber(line.qty_scrap),
        qty_difference: toNumber(line.qty_difference),
      };
    }),
  };
}

function resultFromUnknown(result: unknown): Record<string, unknown> {
  const payload = result && typeof result === 'object'
    ? result as Record<string, unknown>
    : {};
  return payload;
}

function errorResult(error: unknown): {
  code: string;
  message: string;
} {
  const err = error as Error & { code?: string };
  return {
    code: typeof err?.code === 'string' && err.code.length > 0 ? err.code : 'error',
    message: err instanceof Error ? err.message : 'Error desconocido',
  };
}

export async function fetchRouteReconciliation(
  payload: { plan_id?: number; action?: 'get' | 'compute' | 'recompute' | 'done' } = {},
): Promise<GFRouteReconciliation> {
  const body: Record<string, unknown> = {};
  if (typeof payload.plan_id === 'number' && payload.plan_id > 0) {
    body.plan_id = payload.plan_id;
  }
  if (payload.action) {
    body.action = payload.action;
  }

  const result = await postRest<unknown>(`${GF_BASE}/reconciliation`, body);
  return normalizeRouteReconciliation(result);
}

export async function validateRouteCorte(
  payload: { plan_id?: number; notes?: string } = {},
): Promise<GFRouteCorteResult> {
  const body: Record<string, unknown> = {};
  if (typeof payload.plan_id === 'number' && payload.plan_id > 0) {
    body.plan_id = payload.plan_id;
  }
  if (typeof payload.notes === 'string') {
    body.notes = payload.notes;
  }

  try {
    const result = await postRest<unknown>('pwa-ruta/validate-corte', body);
    const data = resultFromUnknown(result);
    return {
      ok: data.ok !== false,
      success: data.success !== false,
      code: typeof data.code === 'string' ? data.code : undefined,
      message: typeof data.message === 'string' ? data.message : 'Corte validado',
      data: data.data && typeof data.data === 'object'
        ? data.data as Record<string, unknown>
        : null,
    };
  } catch (error) {
    const err = errorResult(error);
    return {
      ok: false,
      success: false,
      code: err.code,
      message: err.message,
      data: null,
    };
  }
}

export async function saveRouteCorteAdjustments(
  payload: { plan_id?: number; lines: GFRouteCorteAdjustmentLine[] },
): Promise<GFRouteCorteAdjustmentResult> {
  const body: Record<string, unknown> = {
    lines: payload.lines,
  };
  if (typeof payload.plan_id === 'number' && payload.plan_id > 0) {
    body.plan_id = payload.plan_id;
  }

  try {
    const result = await postRest<unknown>(`${GF_BASE}/corte/adjustments`, body);
    const data = resultFromUnknown(result);
    return {
      ok: data.ok !== false,
      message: typeof data.message === 'string' ? data.message : 'Ajustes de corte guardados',
      data: data.data && typeof data.data === 'object'
        ? data.data as Record<string, unknown>
        : null,
    };
  } catch (error) {
    const err = errorResult(error);
    return {
      ok: false,
      message: err.message,
      data: null,
    };
  }
}

export async function confirmRouteLiquidation(
  payload: {
    plan_id?: number;
    cash_collected?: number;
    notes?: string;
    force?: boolean;
    /**
     * P0-3 (hardening): idempotency key para evitar doble confirmación por
     * doble-tap / retry. El backend actual ignora campos desconocidos, así que
     * enviarlo es compatible; cuando Sebas lo soporte, deduplicará por este id
     * (o por plan_id). Ver docs/KOLDFIELD_BACKEND_HARDENING_REQUESTS.md.
     */
    operation_id?: string;
  } = {},
): Promise<GFRouteLiquidationConfirmResult> {
  const body: Record<string, unknown> = {};
  if (typeof payload.plan_id === 'number' && payload.plan_id > 0) {
    body.plan_id = payload.plan_id;
  }
  if (typeof payload.cash_collected === 'number' && Number.isFinite(payload.cash_collected)) {
    body.cash_collected = payload.cash_collected;
  }
  if (typeof payload.notes === 'string') {
    body.notes = payload.notes;
  }
  if (payload.force === true) {
    body.force = true;
  }
  if (typeof payload.operation_id === 'string' && payload.operation_id) {
    body.operation_id = payload.operation_id;
  }

  try {
    const result = await postRest<unknown>(`${GF_BASE}/liquidacion/confirm`, body);
    const data = resultFromUnknown(result);
    const rawData = data.data && typeof data.data === 'object'
      ? data.data as Record<string, unknown>
      : {};
    return {
      ok: data.ok !== false,
      code: typeof data.code === 'string' ? data.code : undefined,
      message: typeof data.message === 'string' ? data.message : 'Liquidacion confirmada',
      data: {
        plan_id: toNullablePositiveNumber(rawData.plan_id) ?? undefined,
        liquidacion_done_at: typeof rawData.liquidacion_done_at === 'string'
          ? rawData.liquidacion_done_at
          : undefined,
        liquidacion_done_by: typeof rawData.liquidacion_done_by === 'string'
          ? rawData.liquidacion_done_by
          : undefined,
        liquidacion_notes: typeof rawData.liquidacion_notes === 'string'
          ? rawData.liquidacion_notes
          : undefined,
        total_collected: toNumber(rawData.total_collected),
        total_expected: toNumber(rawData.total_expected),
        difference: toNumber(rawData.difference),
        force: Boolean(rawData.force),
        route_close_warning: typeof rawData.route_close_warning === 'string'
          ? rawData.route_close_warning
          : null,
      },
    };
  } catch (error) {
    const err = errorResult(error);
    // #116 idempotencia: reintentar una liquidación que el backend YA confirmó
    // responde `already_confirmed`. Para el vendedor es éxito (el efectivo ya
    // quedó confirmado), no un error. Robusto si llega como ok:false (throw).
    if (isAlreadyConfirmedResponse(err.code, err.message)) {
      return {
        ok: true,
        code: 'already_confirmed',
        message: 'La liquidación ya estaba confirmada.',
        data: null,
      };
    }
    return {
      ok: false,
      code: err.code,
      message: err.message,
      data: null,
    };
  }
}

export async function fetchAnalyticsOptions(
  payload: { partner_id?: number | null; partner_ids?: number[] } = {},
): Promise<Record<string, unknown> | null> {
  try {
    const body: Record<string, unknown> = {};
    if (typeof payload.partner_id === 'number' && payload.partner_id > 0) {
      body.partner_id = payload.partner_id;
    }
    if (Array.isArray(payload.partner_ids) && payload.partner_ids.length > 0) {
      body.partner_ids = payload.partner_ids.filter((id) => typeof id === 'number' && id > 0);
    }

    const result = await postRest<Record<string, unknown>>(
      `${GF_BASE}/analytics/options`,
      body,
    );
    return result;
  } catch (error) {
    if (__DEV__) console.warn('[gfLogistics] analytics/options unavailable, falling back:', error);
    return null;
  }
}

export async function fetchLeadStages(
  companyId?: number | null,
): Promise<Array<{ id: number; name: string; sequence?: number }>> {
  const body: Record<string, unknown> = {};
  if (typeof companyId === 'number' && companyId > 0) {
    body.company_id = companyId;
  }

  const result = await postRest<any>(`${GF_BASE}/lead/stages`, body);
  if (!result || typeof result !== 'object') return [];
  const data = result.data !== undefined ? result.data : result;
  if (Array.isArray(data?.stages)) return data.stages;
  if (Array.isArray(data)) return data;
  return [];
}

export async function upsertLeadData(
  payload: Record<string, unknown>,
  meta?: ClientEventMeta | null,
): Promise<Record<string, unknown> | null> {
  const body = attachClientMetaToRestPayload(payload, meta ?? null);
  const result = await postRest<any>(`${GF_BASE}/lead/upsert`, body);
  if (!result || typeof result !== 'object') return null;
  const data = result.data !== undefined ? result.data : result;
  const lead = data?.lead ?? data;
  return lead && typeof lead === 'object' ? lead : null;
}

export async function startOffrouteVisit(
  payload: Record<string, unknown>,
  meta?: ClientEventMeta | null,
): Promise<Record<string, unknown> | null> {
  const body = attachClientMetaToRestPayload(payload, meta ?? null);
  const result = await postRest<any>(`${GF_BASE}/offroute/visit/start`, body);
  if (!result || typeof result !== 'object') return null;
  const data = result.data !== undefined ? result.data : result;
  const visit = data?.visit ?? data;
  return visit && typeof visit === 'object' ? visit : null;
}

export async function closeOffrouteVisit(
  payload: Record<string, unknown>,
  meta?: ClientEventMeta | null,
): Promise<Record<string, unknown> | null> {
  const body = attachClientMetaToRestPayload(payload, meta ?? null);
  const result = await postRest<any>(`${GF_BASE}/offroute/visit/close`, body);
  if (!result || typeof result !== 'object') return null;
  const data = result.data !== undefined ? result.data : result;
  const visit = data?.visit ?? data;
  return visit && typeof visit === 'object' ? visit : null;
}

// ═══ Gifts / Muestras (gf_salesops) ═══
//
// POST /gf/salesops/gift/create  (type="json" — acepta plain JSON o JSON-RPC)
//
// CONTRATO VERIFICADO contra gf_saleops/controllers/main.py + services/response.py:
//
//   Payload: { meta: { analytic_account_id, idempotency_key }, data: { ... } }
//   - meta.analytic_account_id: el pipeline LO SOBREESCRIBE con el valor derivado
//     del token del empleado (guard, línea 407). Enviarlo es redundante pero
//     inofensivo; sirve como sanity-check del lado cliente.
//   - meta.idempotency_key: usado para deduplicación (use_idempotency=True).
//   - data.mobile_location_id: stock.location.id (NOT warehouse_id). REQUERIDO.
//     Validado contra cfg.mobile_location_ids (allowlist de la sucursal).
//   - data.partner_id: REQUERIDO.
//   - data.lines: [{ product_id, qty }]. REQUERIDO, mínimo 1 línea con qty > 0.
//   - data.visit_line_id: opcional (salesperson.visit.line.id legacy).
//   - data.notes: opcional.
//   - data.validate: true → confirma el picking en Odoo.
//
// FORMATO DE RESPUESTA (services/response.py):
//   Éxito:  { status: "ok",    code: "OK",     user_message, data, meta }
//   Error:  { status: "error", code: <string>, user_message, data, meta }
//   Lock:   { status: "busy",  code: "LOCKED", user_message, data: { retry_after }, meta }
//
// IMPORTANTE — Por qué NO usamos unwrapRestResult para detectar errores:
//   unwrapRestResult solo lanza cuando result.ok === false.
//   Este módulo (gf_saleops) usa result.status, NO result.ok.
//   Si se usara postRest sin inspección, una respuesta de error pasaría
//   silenciosamente como "éxito" con gift_id=0. Se verifica result.status
//   explícitamente en el path de éxito.
//
// Códigos de error conocidos:
//   VALIDATION_ERROR  → datos incorrectos (mobile_location_id, partner_id, lines)
//   FORBIDDEN         → la van no está en cfg.mobile_location_ids
//   SERVER_MISCONFIG  → falta merma_location_id o picking type en Branch Config
//   LOCKED            → la van está en uso (pipeline lock, reintentar)
//   SERVER_ERROR      → excepción inesperada en el servidor

export const GIFT_ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FORBIDDEN: 'FORBIDDEN',
  SERVER_MISCONFIG: 'SERVER_MISCONFIG',
  LOCKED: 'LOCKED',
  SERVER_ERROR: 'SERVER_ERROR',
} as const;

export type GiftErrorCode = keyof typeof GIFT_ERROR_CODES;

export interface GiftCreateSuccess {
  ok: true;
  giftId: number;
  giftName: string;
  pickingId: number;
  state: string;
  userMessage: string;
}

export interface GiftCreateFailure {
  ok: false;
  code: GiftErrorCode | 'UNKNOWN';
  message: string;
  retryAfterSeconds?: number; // presente cuando code === 'LOCKED'
}

export type GiftCreateResult = GiftCreateSuccess | GiftCreateFailure;

export interface GiftLine {
  product_id: number;
  qty: number;
}

export interface GiftCreatePayload {
  analyticAccountId: number; // sanity-check local; el backend lo sobreescribe del token
  idempotencyKey: string;
  mobileLocationId: number;
  partnerId: number;
  visitLineId?: number | null;
  lines: GiftLine[];
  notes?: string;
}

export async function createGift(
  payload: GiftCreatePayload,
): Promise<GiftCreateResult> {
  const body = {
    meta: {
      analytic_account_id: payload.analyticAccountId,
      idempotency_key: payload.idempotencyKey,
    },
    data: {
      mobile_location_id: payload.mobileLocationId,
      partner_id: payload.partnerId,
      ...(payload.visitLineId ? { visit_line_id: payload.visitLineId } : {}),
      lines: payload.lines,
      notes: payload.notes ?? '',
      validate: true,
    },
  };

  try {
    const result = await postRest<Record<string, unknown>>(
      'gf/salesops/gift/create',
      body,
    );

    // ⚠️ CRÍTICO: este módulo usa { status: "error/busy" }, NO { ok: false }.
    // unwrapRestResult no detecta estos errores — hay que inspeccionarlos aquí.
    // Si no se verifica, un error de VALIDATION_ERROR pasaría silenciosamente
    // como éxito con gift_id=0 y el chofer vería "Regalo registrado" en falso.
    const status = typeof result?.status === 'string' ? result.status : 'ok';
    if (status === 'error' || status === 'busy') {
      const code = typeof result?.code === 'string' ? result.code : 'UNKNOWN';
      const msg = typeof result?.user_message === 'string'
        ? result.user_message
        : 'Error desconocido';
      const isKnownCode = code in GIFT_ERROR_CODES;
      const errorData = result?.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};

      logWarn('general', 'gift_create_error_response', {
        endpoint: 'gf/salesops/gift/create',
        status,
        code,
        message: msg,
        partner_id: payload.partnerId,
        mobile_location_id: payload.mobileLocationId,
      });

      return {
        ok: false,
        code: isKnownCode ? (code as GiftErrorCode) : 'UNKNOWN',
        message: msg,
        ...(status === 'busy' && typeof errorData.retry_after === 'number'
          ? { retryAfterSeconds: errorData.retry_after }
          : {}),
      };
    }

    // Éxito: { status: "ok", code: "OK", user_message, data: { gift_id, ... } }
    const data = (result?.data != null ? result.data : {}) as Record<string, unknown>;
    return {
      ok: true,
      giftId: toNumber(data.gift_id),
      giftName: typeof data.gift_name === 'string' ? data.gift_name : '',
      pickingId: toNumber(data.picking_id),
      state: typeof data.state === 'string' ? data.state : 'done',
      userMessage: typeof result?.user_message === 'string'
        ? result.user_message
        : 'Regalo registrado',
    };
  } catch (error: unknown) {
    // Este path cubre: errores de red, HTTP 5xx que sí activan unwrapRestResult,
    // y cualquier excepción inesperada. El campo "code" del backend no llega
    // aquí porque unwrapRestResult solo extrae el message.
    const msg = error instanceof Error ? error.message : String(error);

    logWarn('general', 'gift_create_request_failed', {
      endpoint: 'gf/salesops/gift/create',
      message: msg,
      partner_id: payload.partnerId,
      mobile_location_id: payload.mobileLocationId,
    });

    return { ok: false, code: 'UNKNOWN', message: msg };
  }
}

// ═══ Session ═══

export async function signOut(): Promise<void> {
  try {
    await postRest(`${GF_BASE}/sign_out`);
  } catch {
    // Best effort
  }
}

// ═══ BLD-20260404-013 — Truck stock by warehouse ═══
//
// Tries the new gf_logistics_ops endpoint `/truck_stock` which returns
// products scoped by the chofer's assigned warehouse. If the endpoint
// does not exist yet (HTTP 404, gateway error, or empty/invalid payload)
// the caller is expected to fall back to the legacy `odooRead` path.
//
// Contract (expected from Sprint 3 P4, still not deployed in backend):
//   POST /gf/logistics/api/employee/truck_stock
//   Body: { warehouse_id?: number, mobile_location_id?: number }
//   Response: {
//     ok: true,
//     data: {
//       warehouse_id: number,
//       products: [
//         { id, name, default_code, list_price, qty_available,
//           sale_ok, product_tmpl_id, weight, categ_id }, ...
//       ]
//     }
//   }
//
// Returns `null` when the endpoint is unavailable — caller must treat
// `null` as "fall back to existing behaviour". NEVER throws.
/**
 * BLD-20260424-STOCKMETA: la respuesta de /truck_stock ahora trae el flag
 * `has_stock_data` (commit dd78489 de Sebastián). El backend lo calcula
 * sobre el qty_map COMPLETO antes de filtrar/ordenar productos, así que
 * representa el stock real del almacén — no la lista que llega al cliente.
 *
 * Significado:
 *   - has_stock_data === true  → almacén tiene stock sincronizado
 *   - has_stock_data === false → catálogo existe pero sin stock real
 *
 * El cliente lo usa para decidir si muestra los productos como
 * "Agotado/referencia" (BUG A original) en lugar de inferir desde
 * la heurística "todos en 0" del lado app.
 */
export interface TruckStockResponse {
  products: unknown[];
  hasStockData: boolean;
}

export async function fetchTruckStock(
  warehouseId: number | null | undefined,
  mobileLocationId: number | null | undefined,
): Promise<TruckStockResponse | null> {
  try {
    const body: Record<string, unknown> = {};
    if (warehouseId && warehouseId > 0) body.warehouse_id = warehouseId;
    if (mobileLocationId && mobileLocationId > 0) body.mobile_location_id = mobileLocationId;
    const result = await postRest<any>(`${GF_BASE}/truck_stock`, body);
    if (!result || typeof result !== 'object') return null;
    if (result.ok === false) return null;
    const data = result.data !== undefined ? result.data : result;
    const products = (data && Array.isArray(data.products)) ? data.products : null;
    if (!products) return null;
    // Si el backend no lo manda (compat), asumimos `true` (comportamiento
    // legacy: aceptar la lista tal cual y dejar que el cliente decida).
    const hasStockData = typeof data?.has_stock_data === 'boolean'
      ? data.has_stock_data
      : true;
    return { products, hasStockData };
  } catch (error) {
    // Endpoint not deployed yet, auth issue, offline, etc.
    // We swallow so the caller transparently falls back.
    if (__DEV__) console.warn('[gfLogistics] truck_stock unavailable, falling back:', error);
    return null;
  }
}
