/**
 * Auth store — GlobalUser equivalent from xVan.
 * From KOLD_FIELD_SPEC.md section 4 + xvan_audit.md.
 *
 * BLD-20260404-007: Fix mapping snake_case (backend) <-> camelCase (frontend).
 * Backend returns employee fields in snake_case and many2one as [id, name] tuples.
 */

import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import {
  setAuthTokens,
  clearAuthTokens,
  setBaseUrl,
  fetchWithTimeout,
  AUTH_TIMEOUT_MS,
} from '../services/api';
import { signOut } from '../services/gfLogistics';
import { resolveOdooDatabase } from '../services/odooDatabase';
import { extractEmployeeAnalyticPlaza } from '../services/extractEmployeeAnalyticPlaza';
import {
  clearSensitiveFieldData,
  storeSaveStrict,
  storeLoad,
  storeRemove,
  storeRemoveStrict,
  STORAGE_KEYS,
} from '../persistence/storage';
import { clearPricelistCaches } from '../services/pricelist';
import { isRestorableSession } from '../services/authOffline';
import { commitAuthStateBeforeSync } from '../services/authCredentialCleanup';
import {
  clearFieldDataIdentity,
  getFieldDataSession,
  setFieldDataIdentity,
} from '../services/fieldDataSession';
import { useSalesStore } from './useSalesStore';
import { createUuidV4 } from '../utils/clientEvent';
import { transferEmployeeDayBundleForReauthentication } from '../services/employeeDayBundle';

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
  beginReauthentication: () => void;
  logout: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  rehydrateAuth: () => Promise<boolean>;
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
  // Keep this deferred import explicit: route -> sync -> product already
  // depends on auth, so a static import here would close that module cycle.
  const { useRouteStore } = await import('./useRouteStore');
  const [
    { useVisitStore },
    { useProductStore },
    { useSyncStore },
  ] = await Promise.all([
    import('./useVisitStore'),
    import('./useProductStore'),
    import('./useSyncStore'),
  ]);
  useRouteStore.getState().reset();
  useVisitStore.getState().resetVisit();
  useProductStore.getState().reset();
  useSyncStore.getState().resetForSessionChange();
  await Promise.all([
    storeRemove(STORAGE_KEYS.PLAN),
    storeRemove(STORAGE_KEYS.STOPS),
  ]);
}

async function clearCurrentEncryptedFieldData(): Promise<void> {
  try {
    const session = await getFieldDataSession();
    const [
      { clearLegacyConsignmentPendingOperations },
      { clearEncryptedSession },
      { clearInvoiceCollectionReauthenticationRequired },
      { retireAndClearInvoiceCollectionSessionState },
      { resetInvoiceCollectionSync },
    ] = await Promise.all([
      import('../services/consignmentOperationPersistence'),
      import('../services/encryptedStore.ts'),
      import('../services/invoiceCollectionReauthLatch.ts'),
      import('../services/invoiceCollectionReauthLatchLogic.ts'),
      import('../services/invoiceCollectionSync'),
    ]);
    if (session) {
      await retireAndClearInvoiceCollectionSessionState({
        retireProcessor: () => resetInvoiceCollectionSync(),
        clearPreEnvelopeState: () => clearLegacyConsignmentPendingOperations(),
        clearEncryptedSession: async () => { await clearEncryptedSession(session); },
        clearReauthenticationLatch: () => clearInvoiceCollectionReauthenticationRequired(session),
      });
    } else {
      await resetInvoiceCollectionSync();
      await clearLegacyConsignmentPendingOperations();
    }
    await clearSensitiveFieldData();
  } finally {
    // Destructive logout/account switch must not retain the old credential
    // even when encrypted field cleanup reports a storage failure.
    let cleanupFailure: unknown;
    try {
      await clearAuthTokens();
    } catch (error) {
      cleanupFailure = error;
    }
    try {
      await storeRemoveStrict(STORAGE_KEYS.AUTH_STATE);
    } catch (error) {
      cleanupFailure ??= error;
    }
    clearFieldDataIdentity();
    if (cleanupFailure !== undefined) throw cleanupFailure;
  }
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

  // Preserve the current principal/session as a handoff candidate. The root
  // auth guard routes to login; only a successful same-principal login may
  // transfer the validated collection record to its new encrypted session.
  beginReauthentication: () => set({ isAuthenticated: false, error: null }),

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

      const companyId = typeof saved.companyId === 'number' ? saved.companyId : null;
      if (companyId && companyId > 0) {
        setFieldDataIdentity({ companyId, employeeId });
      }

      console.log(`[auth] Rehydrated: employee=${employeeId}, warehouse=${warehouseId}`);
      return true;
    } catch (error) {
      console.error('[auth] Rehydrate failed:', error);
      return false;
    }
  },

  login: async (baseUrl, barcode, pin, db) => {
    let destructiveSessionActivation = false;
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
      // devices running React Native 0.76. The REST helpers already
      // use fetch for the same reason — login must too.
      let response: Response;
      try {
        // AUTH_TIMEOUT_MS: el login corría con fetch SIN timeout — colgado
        // indefinido en red degradada (pendiente de auditoría julio).
        response = await fetchWithTimeout(loginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            params: { barcode, pin, db: dbName },
          }),
        }, AUTH_TIMEOUT_MS);
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
      if (typeof result?.gf_employee_token !== 'string' || !result.gf_employee_token.trim()) {
        const backendMsg = result?.message || payload?.error?.data?.message;
        set({ error: backendMsg || 'Credenciales incorrectas', isLoading: false });
        return false;
      }

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
      const companyId = extractId(companyRaw);
      const previousSession = await getFieldDataSession();
      const samePrincipalReauthentication = previousSession !== null
        && typeof employeeId === 'number' && employeeId > 0
        && typeof companyId === 'number' && companyId > 0
        && previousSession.employeeId === employeeId
        && previousSession.companyId === companyId;
      const authenticatedEmployeeState = {
        employeeId,
        employeeName: (pick<string>(emp, 'employeeName', 'name') as string) ?? '',
        companyId,
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
        mustTakePhotosToEndVisit: true,
        blockSaleIfUnpaidInvoices: false,
        defaultPaymentJournalId: extractId(paymentJournalRaw),
        defaultCashAccountId: extractId(cashAccountRaw),
        customerIds: (pick<number[]>(emp, 'customerIds', 'customer_ids') as number[]) ?? [],
      };

      if (samePrincipalReauthentication) {
        // Persist while the old same-principal credential/session is still
        // intact. A failure cannot strand the transferred UUID under a token
        // rotation whose auth projection was never made durable.
        await storeSaveStrict(STORAGE_KEYS.AUTH_STATE, authenticatedEmployeeState);
        const nextSession = { companyId, employeeId, sessionId: createUuidV4() };
        const [{ transferCurrentInvoiceCollectionsForReauthentication }, { resetInvoiceCollectionSync }] = await Promise.all([
          import('../services/invoiceCollectionPersistence.ts'),
          import('../services/invoiceCollectionSync.ts'),
        ]);
        await transferCurrentInvoiceCollectionsForReauthentication(
          previousSession,
          nextSession,
          () => setAuthTokens(result.gf_employee_token, nextSession.sessionId),
          () => resetInvoiceCollectionSync(),
        );
        // Fase Capa 1 (fix/daily-bundle-validation): the encrypted storage key
        // includes sessionId, so this same-principal rotation would otherwise
        // orphan a still-valid day bundle under the old key. Transfer it before
        // the old envelope is destroyed below — same handoff shape as the
        // invoice-collection transfer above, minus a live processor to retire.
        await transferEmployeeDayBundleForReauthentication(previousSession, nextSession);
        // Collection transfer committed and removed its old record. Remove the
        // rest of the obsolete envelope; no other feature crosses sessions.
        const [
          { clearEncryptedSession },
          { clearInvoiceCollectionReauthenticationRequired },
          { retireAndClearInvoiceCollectionSessionState },
        ] = await Promise.all([
          import('../services/encryptedStore.ts'),
          import('../services/invoiceCollectionReauthLatch.ts'),
          import('../services/invoiceCollectionReauthLatchLogic.ts'),
        ]);
        await retireAndClearInvoiceCollectionSessionState({
          retireProcessor: () => resetInvoiceCollectionSync(),
          clearEncryptedSession: async () => { await clearEncryptedSession(previousSession); },
          clearReauthenticationLatch: () => clearInvoiceCollectionReauthenticationRequired(previousSession),
        });
        await clearSensitiveFieldData();
        clearFieldDataIdentity();
      } else {
        set({ isAuthenticated: false });
        await clearCurrentEncryptedFieldData();
        // Actual logout/account switch remains destructive while the prior
        // session reference is still readable, and never transfers evidence.
        destructiveSessionActivation = true;
        await setBaseUrl(baseUrl);
        await setAuthTokens(result.gf_employee_token);
      }
      await clearRouteCache();
      clearPricelistCaches();
      useSalesStore.getState().reset();

      set({ isAuthenticated: true, isLoading: false, error: null, ...authenticatedEmployeeState });

      if (companyId && companyId > 0) {
        setFieldDataIdentity({ companyId, employeeId });
      }

      const { resumeInvoiceCollectionSync, requestInvoiceCollectionSync } = await import(
        '../services/invoiceCollectionSync'
      );
      const resumeSync = () => {
        resumeInvoiceCollectionSync();
        requestInvoiceCollectionSync();
      };
      if (samePrincipalReauthentication) {
        resumeSync();
      } else {
        // Account switches cannot reuse the old projection. Keep sync suspended
        // until this strict write pairs the new credential with its principal.
        await commitAuthStateBeforeSync({
          persist: () => storeSaveStrict(STORAGE_KEYS.AUTH_STATE, authenticatedEmployeeState),
          rollback: async () => {
            destructiveSessionActivation = false;
            await clearCurrentEncryptedFieldData();
          },
          resume: resumeSync,
        });
      }
      destructiveSessionActivation = false;

      return true;
    } catch (error: unknown) {
      if (destructiveSessionActivation) {
        try {
          await clearCurrentEncryptedFieldData();
        } catch {
          // The cleanup path attempts credentials and AUTH_STATE independently;
          // keep the original login failure for the operator.
        }
      }
      const msg = error instanceof Error ? error.message : 'Error de conexion';
      set({ isAuthenticated: false, error: msg, isLoading: false });
      return false;
    }
  },

  logout: async () => {
    set({ isAuthenticated: false });
    try {
      await signOut();
    } finally {
      await clearCurrentEncryptedFieldData();
      await clearRouteCache();
      useSalesStore.getState().reset();
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
