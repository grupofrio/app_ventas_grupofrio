/**
 * Auth store — GlobalUser equivalent from xVan.
 * From KOLD_FIELD_SPEC.md section 4 + xvan_audit.md.
 *
 * BLD-20260404-007: Fix mapping snake_case (backend) <-> camelCase (frontend).
 * Backend returns employee fields in snake_case and many2one as [id, name] tuples.
 */

import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { setAuthTokens, clearAuthTokens, setBaseUrl } from '../services/api';
import { signOut } from '../services/gfLogistics';
import { clearOdooSession } from '../services/odooSession';
import { resolveOdooDatabase } from '../services/odooDatabase';
import { extractEmployeeAnalyticPlaza, fetchEmployeeAnalyticPlaza } from '../services/employeeAnalytics';
import { storeSave, storeLoad, storeRemove, STORAGE_KEYS } from '../persistence/storage';
import { clearPricelistCaches } from '../services/pricelist';
import { isRestorableSession } from '../services/authOffline';
import { useSalesStore } from './useSalesStore';

interface AuthState {
  // Auth status
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Employee data (GlobalUser equivalent)
  employeeId: number | null;
  employeeName: string;
  companyId: number | null;
  companyName: string;
  warehouseId: number | null;
  warehouseName: string;
  mobileLocationId: number | null;
  mobileLocationName: string;
  employeeAnalyticPlazaId: number | null;
  employeeAnalyticPlazaName: string;
  parentId: number | null; // supervisor
  isSupervisor: boolean;

  // Permissions
  allowCreateCustomer: boolean;
  allowFreeVisitsMode: boolean;
  allowConfirmPayment: boolean;
  allowDeliveryScreen: boolean;
  allowSalesDirectInvoice: boolean;
  allowOffDateVisits: boolean;
  allowOffDistanceVisits: boolean;
  maxCashLimit: number;
  stockValueLimit: number;
  mustTakePhotosToEndVisit: boolean; // ALWAYS TRUE
  blockSaleIfUnpaidInvoices: boolean; // FALSE (warning only)
  defaultPaymentJournalId: number | null;
  defaultCashAccountId: number | null;
  customerIds: number[];

  // Actions
  login: (baseUrl: string, barcode: string, pin: string, db?: string | null) => Promise<boolean>;
  logout: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  rehydrateAuth: () => Promise<boolean>;
  ensureEmployeeAnalytics: () => Promise<void>;
}

// ============================================================
// Helpers: Odoo payload normalization
// ============================================================

/**
 * Extract id from Odoo many2one tuple [id, name] or direct value.
 * Returns null if the value is falsy or invalid.
 */
function extractId(v: unknown): number | null {
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'number') return v[0];
  if (typeof v === 'number') return v;
  return null;
}

/**
 * Extract name from Odoo many2one tuple [id, name] or plain string.
 */
function extractName(v: unknown): string {
  if (Array.isArray(v) && v.length > 1) return String(v[1] ?? '');
  if (typeof v === 'string') return v;
  return '';
}

/**
 * Pick the first defined value from multiple possible keys.
 * Used to support both camelCase (legacy) and snake_case (Odoo native) field names.
 */
function pick<T = unknown>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

// Employee payload coming from /api/employee-sign-in.
// Accepts both casings because the field keeps evolving in the Odoo module.
interface EmployeePayload {
  [key: string]: unknown;
}

async function clearRouteCache(): Promise<void> {
  const { useRouteStore } = await import('./useRouteStore');
  useRouteStore.getState().reset();
  await Promise.all([
    storeRemove(STORAGE_KEYS.PLAN),
    storeRemove(STORAGE_KEYS.STOPS),
  ]);
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: false,
  error: null,
  employeeId: null,
  employeeName: '',
  companyId: null,
  companyName: '',
  warehouseId: null,
  warehouseName: '',
  mobileLocationId: null,
  mobileLocationName: '',
  employeeAnalyticPlazaId: null,
  employeeAnalyticPlazaName: '',
  parentId: null,
  isSupervisor: false,
  allowCreateCustomer: false,
  allowFreeVisitsMode: false,
  allowConfirmPayment: false,
  allowDeliveryScreen: false,
  allowSalesDirectInvoice: false,
  allowOffDateVisits: false,
  allowOffDistanceVisits: false,
  maxCashLimit: 0,
  stockValueLimit: 0,
  mustTakePhotosToEndVisit: true,
  blockSaleIfUnpaidInvoices: false,
  defaultPaymentJournalId: null,
  defaultCashAccountId: null,
  customerIds: [],

  setLoading: (loading) => set({ isLoading: loading }),

  ensureEmployeeAnalytics: async () => {
    const state = useAuthStore.getState();
    if (!state.isAuthenticated || !state.employeeId || state.employeeAnalyticPlazaId) {
      return;
    }

    try {
      const plaza = await fetchEmployeeAnalyticPlaza(state.employeeId);
      if (!plaza.id) return;

      set({
        employeeAnalyticPlazaId: plaza.id,
        employeeAnalyticPlazaName: plaza.name,
      });

      const nextState = useAuthStore.getState();
      await storeSave(STORAGE_KEYS.AUTH_STATE, {
        employeeId: nextState.employeeId,
        employeeName: nextState.employeeName,
        companyId: nextState.companyId,
        companyName: nextState.companyName,
        warehouseId: nextState.warehouseId,
        warehouseName: nextState.warehouseName,
        mobileLocationId: nextState.mobileLocationId,
        mobileLocationName: nextState.mobileLocationName,
        employeeAnalyticPlazaId: nextState.employeeAnalyticPlazaId,
        employeeAnalyticPlazaName: nextState.employeeAnalyticPlazaName,
        parentId: nextState.parentId,
        isSupervisor: nextState.isSupervisor,
        allowCreateCustomer: nextState.allowCreateCustomer,
        allowFreeVisitsMode: nextState.allowFreeVisitsMode,
        allowConfirmPayment: nextState.allowConfirmPayment,
        allowDeliveryScreen: nextState.allowDeliveryScreen,
        allowSalesDirectInvoice: nextState.allowSalesDirectInvoice,
        allowOffDateVisits: nextState.allowOffDateVisits,
        allowOffDistanceVisits: nextState.allowOffDistanceVisits,
        maxCashLimit: nextState.maxCashLimit,
        stockValueLimit: nextState.stockValueLimit,
        defaultPaymentJournalId: nextState.defaultPaymentJournalId,
        defaultCashAccountId: nextState.defaultCashAccountId,
        customerIds: nextState.customerIds,
      });
    } catch (error) {
      console.warn('[auth] Could not hydrate employee analytic plaza:', error);
    }
  },

  /**
   * BLD-20260408-P0: Restore employee data from AsyncStorage.
   * Called on startup BEFORE setting isAuthenticated.
   * Returns true if a valid session was restored (employeeId + warehouseId present).
   */
  rehydrateAuth: async () => {
    try {
      const saved = await storeLoad<Record<string, unknown>>(STORAGE_KEYS.AUTH_STATE);

      // A valid local session MUST have employeeId + warehouseId (sin ellos,
      // inventario y ruta fallarían en silencio). Regla centralizada en
      // isRestorableSession para poder testearla sin RN/zustand.
      const check = isRestorableSession(saved);
      if (!check.ok || !saved || typeof saved !== 'object') {
        console.warn(`[auth] Rehydrate: ${check.reason}, forcing re-login`);
        await storeRemove(STORAGE_KEYS.AUTH_STATE);
        return false;
      }
      const employeeId = saved.employeeId as number;
      const warehouseId = saved.warehouseId as number;

      set({
        isAuthenticated: true,
        employeeId,
        employeeName: typeof saved.employeeName === 'string' ? saved.employeeName : '',
        companyId: typeof saved.companyId === 'number' ? saved.companyId : null,
        companyName: typeof saved.companyName === 'string' ? saved.companyName : '',
        warehouseId,
        warehouseName: typeof saved.warehouseName === 'string' ? saved.warehouseName : '',
        mobileLocationId: typeof saved.mobileLocationId === 'number' ? saved.mobileLocationId : null,
        mobileLocationName: typeof saved.mobileLocationName === 'string' ? saved.mobileLocationName : '',
        employeeAnalyticPlazaId: typeof saved.employeeAnalyticPlazaId === 'number' ? saved.employeeAnalyticPlazaId : null,
        employeeAnalyticPlazaName: typeof saved.employeeAnalyticPlazaName === 'string' ? saved.employeeAnalyticPlazaName : '',
        parentId: typeof saved.parentId === 'number' ? saved.parentId : null,
        isSupervisor: !!saved.isSupervisor,
        allowCreateCustomer: !!saved.allowCreateCustomer,
        allowFreeVisitsMode: !!saved.allowFreeVisitsMode,
        allowConfirmPayment: !!saved.allowConfirmPayment,
        allowDeliveryScreen: !!saved.allowDeliveryScreen,
        allowSalesDirectInvoice: !!saved.allowSalesDirectInvoice,
        allowOffDateVisits: !!saved.allowOffDateVisits,
        allowOffDistanceVisits: !!saved.allowOffDistanceVisits,
        maxCashLimit: typeof saved.maxCashLimit === 'number' ? saved.maxCashLimit : 0,
        stockValueLimit: typeof saved.stockValueLimit === 'number' ? saved.stockValueLimit : 0,
        mustTakePhotosToEndVisit: true,
        blockSaleIfUnpaidInvoices: false,
        defaultPaymentJournalId: typeof saved.defaultPaymentJournalId === 'number' ? saved.defaultPaymentJournalId : null,
        defaultCashAccountId: typeof saved.defaultCashAccountId === 'number' ? saved.defaultCashAccountId : null,
        customerIds: Array.isArray(saved.customerIds) ? saved.customerIds as number[] : [],
      });

      console.log(`[auth] Rehydrated: employee=${employeeId}, warehouse=${warehouseId}`);
      return true;
    } catch (error) {
      console.error('[auth] Rehydrate failed:', error);
      return false;
    }
  },

  login: async (baseUrl, barcode, pin, db) => {
    set({ isLoading: true, error: null });
    try {
      await setBaseUrl(baseUrl);

      const dbName = await resolveOdooDatabase(baseUrl, db);
      if (!dbName) {
        set({ error: 'No se pudo resolver la base de datos de Odoo', isLoading: false });
        return false;
      }

      const loginUrl = `${baseUrl}/api/employee-sign-in`;
      const netState = await NetInfo.fetch();
      const isOnline = !!(netState.isConnected && netState.isInternetReachable !== false);
      console.log('[login] start', {
        url: loginUrl,
        db: dbName,
        isOnline,
        isConnected: netState.isConnected,
        isInternetReachable: netState.isInternetReachable,
        type: netState.type,
      });

      // BLD-20260404-007 (Fix 4): Use fetch instead of axios.
      // Axios XHR adapter fails with generic Network Error on some Android
      // devices running React Native 0.76. The postRest/postRpc helpers already
      // use fetch for the same reason — login must too.
      let response: Response;
      try {
        response = await fetch(loginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            params: { barcode, pin, db: dbName },
          }),
        });
      } catch (netErr) {
        const msg = netErr instanceof Error ? netErr.message : 'Error de red';
        console.warn('[login] Network error:', {
          url: loginUrl,
          message: msg,
          isOnline,
          type: netState.type,
          isConnected: netState.isConnected,
          isInternetReachable: netState.isInternetReachable,
        });
        set({
          error: isOnline
            ? `No se pudo conectar a ${loginUrl}. Posible DNS/VPN/TLS.`
            : 'Sin conexion en el dispositivo. Verifica tu red.',
          isLoading: false,
        });
        return false;
      }

      if (!response.ok) {
        console.warn('[login] HTTP error:', {
          url: loginUrl,
          status: response.status,
          statusText: response.statusText,
          isOnline,
        });
        set({ error: `Error del servidor (${response.status})`, isLoading: false });
        return false;
      }

      let payload: any;
      try {
        payload = await response.json();
      } catch {
        console.warn('[login] Invalid JSON response from', loginUrl);
        set({ error: 'Respuesta del servidor invalida', isLoading: false });
        return false;
      }

      const result = payload?.result;
      if (!result?.api_key) {
        const backendMsg = result?.message || payload?.error?.data?.message;
        set({ error: backendMsg || 'Credenciales incorrectas', isLoading: false });
        return false;
      }

      await setAuthTokens(result.api_key, result.gf_employee_token || '');
      await clearRouteCache();
      clearPricelistCaches();
      useSalesStore.getState().reset();

      const emp: EmployeePayload = result.employee || {};

      // Accept both camelCase (legacy mock) and snake_case (real Odoo) field names.
      // Many-to-one fields (warehouse_id, company_id, etc.) arrive as [id, name] tuples.
      const warehouseRaw = pick(emp, 'warehouseId', 'warehouse_id');
      const companyRaw = pick(emp, 'companyId', 'company_id');
      const mobileLocationRaw = pick(emp, 'mobileLocationId', 'mobile_location_id', 'mobile_location');
      const parentRaw = pick(emp, 'parentId', 'parent_id');
      const paymentJournalRaw = pick(emp, 'defaultPaymentJournalId', 'default_payment_journal_id');
      const cashAccountRaw = pick(emp, 'defaultCashAccountId', 'default_cash_account_id');
      // Try to extract plaza from login response (fast path)
      const analyticPlazaFromLogin = extractEmployeeAnalyticPlaza(emp);
      const employeeId = (pick<number>(emp, 'employeeId', 'id') as number) ?? null;

      set({
        isAuthenticated: true,
        isLoading: false,
        error: null,
        employeeId,
        employeeName: (pick<string>(emp, 'employeeName', 'name') as string) ?? '',
        companyId: extractId(companyRaw),
        companyName: (pick<string>(emp, 'companyName') as string) ?? extractName(companyRaw),
        warehouseId: extractId(warehouseRaw),
        warehouseName: (pick<string>(emp, 'warehouseName') as string) ?? extractName(warehouseRaw),
        mobileLocationId: extractId(mobileLocationRaw),
        mobileLocationName: (pick<string>(emp, 'mobileLocationName') as string) ?? extractName(mobileLocationRaw),
        employeeAnalyticPlazaId: analyticPlazaFromLogin.id,
        employeeAnalyticPlazaName: analyticPlazaFromLogin.name,
        parentId: extractId(parentRaw),
        isSupervisor: !!pick(emp, 'isSupervisor', 'is_supervisor'),
        allowCreateCustomer: !!pick(emp, 'allowCreateCustomer', 'allow_create_customer'),
        allowFreeVisitsMode: !!pick(emp, 'allowFreeVisitsMode', 'allow_free_visits_mode'),
        allowConfirmPayment: !!pick(emp, 'allowConfirmPayment', 'allow_confirm_payment'),
        allowDeliveryScreen: !!pick(emp, 'allowDeliveryScreen', 'allow_delivery_screen'),
        allowSalesDirectInvoice: !!pick(emp, 'allowSalesDirectInvoice', 'allow_sales_direct_invoice'),
        allowOffDateVisits: !!pick(emp, 'allowOffDateVisits', 'allow_offdate_visits'),
        allowOffDistanceVisits: !!pick(emp, 'allowOffDistanceVisits', 'allow_offdistance_visits', 'allow_off_distance_visits'),
        maxCashLimit: (pick<number>(emp, 'maxCashLimit', 'max_cash_limit') as number) ?? 0,
        stockValueLimit: (pick<number>(emp, 'stockValueLimit', 'stock_value_limit') as number) ?? 0,
        mustTakePhotosToEndVisit: true, // ALWAYS TRUE
        blockSaleIfUnpaidInvoices: false, // WARNING only
        defaultPaymentJournalId: extractId(paymentJournalRaw),
        defaultCashAccountId: extractId(cashAccountRaw),
        customerIds: (pick<number[]>(emp, 'customerIds', 'customer_ids') as number[]) ?? [],
      });

      // Fetch plaza analytic from hr.employee if login response didn't include it.
      // Runs synchronously before returning so the sale screen always has plaza set.
      if (!analyticPlazaFromLogin.id && employeeId) {
        try {
          const plaza = await fetchEmployeeAnalyticPlaza(employeeId);
          if (plaza.id) {
            set({ employeeAnalyticPlazaId: plaza.id, employeeAnalyticPlazaName: plaza.name });
          }
        } catch {
          console.warn('[auth] Could not fetch employee analytic plaza on login');
        }
      }

      // BLD-20260408-P0: Persist auth state so it survives app restart.
      const state = useAuthStore.getState();
      await storeSave(STORAGE_KEYS.AUTH_STATE, {
        employeeId: state.employeeId,
        employeeName: state.employeeName,
        companyId: state.companyId,
        companyName: state.companyName,
        warehouseId: state.warehouseId,
        warehouseName: state.warehouseName,
        mobileLocationId: state.mobileLocationId,
        mobileLocationName: state.mobileLocationName,
        employeeAnalyticPlazaId: state.employeeAnalyticPlazaId,
        employeeAnalyticPlazaName: state.employeeAnalyticPlazaName,
        parentId: state.parentId,
        isSupervisor: state.isSupervisor,
        allowCreateCustomer: state.allowCreateCustomer,
        allowFreeVisitsMode: state.allowFreeVisitsMode,
        allowConfirmPayment: state.allowConfirmPayment,
        allowDeliveryScreen: state.allowDeliveryScreen,
        allowSalesDirectInvoice: state.allowSalesDirectInvoice,
        allowOffDateVisits: state.allowOffDateVisits,
        allowOffDistanceVisits: state.allowOffDistanceVisits,
        maxCashLimit: state.maxCashLimit,
        stockValueLimit: state.stockValueLimit,
        defaultPaymentJournalId: state.defaultPaymentJournalId,
        defaultCashAccountId: state.defaultCashAccountId,
        customerIds: state.customerIds,
      });

      return true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error de conexion';
      set({ error: msg, isLoading: false });
      return false;
    }
  },

  logout: async () => {
    try {
      await signOut();
    } finally {
      clearOdooSession();
      await clearRouteCache();
      useSalesStore.getState().reset();
      await clearAuthTokens();
      await storeRemove(STORAGE_KEYS.AUTH_STATE);
      set({
        isAuthenticated: false,
        employeeId: null,
        employeeName: '',
        companyId: null,
        companyName: '',
        warehouseId: null,
        warehouseName: '',
        mobileLocationId: null,
        mobileLocationName: '',
        employeeAnalyticPlazaId: null,
        employeeAnalyticPlazaName: '',
        customerIds: [],
      });
    }
  },
}));
