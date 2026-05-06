/**
 * Odoo JSON-RPC wrapper.
 * From KOLD_FIELD_SPEC.md section 5 — generic endpoints.
 *
 * BLD-20260409: odooRpc now uses sessionRpc (Odoo web session) instead of
 * the custom Api-Key auth, because /web/dataset/call_kw requires a session
 * cookie. The Api-Key + X-GF-Employee-Token headers only work with custom
 * gf_logistics_ops endpoints (/get_records, /api/employee-sign-in, etc.)
 */

import { postRpc } from './api';
import { sessionRpc, hasServiceCredentials } from './odooSession';

/**
 * Read records from Odoo via get_records endpoint.
 */
export async function odooRead<T = unknown>(
  model: string,
  domain: unknown[] = [],
  fields: string[] = [],
  limit = 100,
  offset = 0,
  order?: string
): Promise<T[]> {
  try {
    // BLD-20260404-007: Backend may return either a plain array or
    // a wrapped object { status, count, response: [...], message }.
    const result = await postRpc<any>('/get_records', { model, domain, fields, limit, offset, order });
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      if (result.ok === false || typeof result.error === 'string' || (typeof result.case === 'number' && result.case < 0)) {
        throw new Error(result.error || `Odoo read rejected for ${model}`);
      }
    }
    if (Array.isArray(result)) return result as T[];
    if (result && Array.isArray(result.response)) return result.response as T[];
    return [];
  } catch (error) {
    console.warn(`[odooRead] ${model} failed:`, error);
    return [];
  }
}

/**
 * Create or update record in Odoo.
 */
export async function odooWrite(
  model: string,
  method: 'create' | 'write',
  dict: Record<string, unknown>
): Promise<number | boolean> {
  const result = await postRpc<number | boolean>('/api/create_update', { model, method, dict });
  return result;
}

/**
 * Direct JSON-RPC call to Odoo via authenticated web session.
 *
 * Uses /web/dataset/call_kw with session cookie authentication.
 * This properly resolves property fields (property_product_pricelist)
 * and has full ORM access — unlike the custom /get_records endpoint
 * which runs as public and can't read res.partner or pricelist items.
 */
export async function odooRpc<T = unknown>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  if (!hasServiceCredentials()) {
    throw new Error('[odooRpc] Service credentials not configured. Call setServiceCredentials() first.');
  }
  return await sessionRpc<T>(model, method, args, kwargs);
}

/**
 * BLD-20260424-KOLDACL: koldRead distingue 3 estados:
 *   - T[]   → datos legítimos (puede ser [] si no hay registros).
 *   - null  → endpoint NO disponible para este usuario en esta sesión
 *             (módulo no instalado, ACL denied, error de modelo).
 *
 * Antes solo veía si la llamada tiraba excepción (poco común porque
 * postRpc envuelve casi todo en HTTP 200), por lo que un ACL denied
 * que devuelve `{ error, case: -3 }` con status 200 se traducía en
 * `[]` y los callers (useKoldStore) creían que el módulo SÍ estaba
 * disponible — se quedaban reintentando indefinidamente cada plan
 * refresh, generando ruido en los logs del backend.
 *
 * Ahora detectamos el envelope `{ error, case }` que el módulo os_api
 * usa para reportar fallos sin romper la cadena HTTP, y devolvemos
 * null para que el caller sepa que tiene que apagar el módulo en
 * memoria por el resto de la sesión.
 */
export async function koldRead<T = unknown>(
  model: string,
  domain: unknown[] = [],
  fields: string[] = [],
  limit = 100
): Promise<T[] | null> {
  try {
    // Llamada cruda para inspeccionar el envelope del backend.
    const result = await postRpc<any>('/get_records', {
      model, domain, fields, limit, offset: 0,
    });

    // Caso ACL/módulo: backend responde 200 con `{ error, case: -3 }`
    // o variantes negativas. Tratamos ese envelope como "no disponible".
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      if (typeof result.error === 'string' && result.error.length > 0) {
        return null;
      }
      if (typeof result.case === 'number' && result.case < 0) {
        return null;
      }
    }

    // Caminos normales (legacy y nuevo)
    if (Array.isArray(result)) return result as T[];
    if (result && Array.isArray(result.response)) return result.response as T[];
    // Cualquier otra cosa: tratamos como NO disponible.
    return null;
  } catch {
    // Module not installed or model doesn't exist
    return null;
  }
}
