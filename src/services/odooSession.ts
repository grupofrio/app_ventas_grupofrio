/**
 * Odoo Session Manager.
 *
 * The mobile app authenticates employees via /api/employee-sign-in (custom module),
 * which returns Api-Key + X-GF-Employee-Token. However, these tokens do NOT work
 * with Odoo's standard JSON-RPC endpoints (/web/dataset/call_kw) which require
 * a session cookie.
 *
 * This module uses TWO strategies:
 *   1. React Native's automatic cookie jar — after /web/session/authenticate,
 *      fetch() automatically includes the session cookie on subsequent requests
 *      to the same origin. Uses `credentials: 'include'` to enable this.
 *   2. /jsonrpc with execute_kw — standard Odoo external API that uses
 *      [db, uid, password] for auth, no cookies needed.
 *
 * Credentials are loaded from a service account configured via setServiceCredentials().
 */

import { getBaseUrl } from './api';
import { candidateOdooDatabases, fetchOdooDatabaseNames } from './odooDatabase';
import { buildHttpTraceData } from '../utils/httpDebug';
import { logError, logInfo, logWarn } from '../utils/logger';

// ── Session state ──

let _uid: number | null = null;
let _authenticated = false;
let _authenticating: Promise<boolean> | null = null;

const DEFAULT_DB = 'grupofrio-grupofrio-31972140';

// Service account credentials — set once at app startup
let _serviceLogin: string | null = null;
let _servicePassword: string | null = null;
let _configuredDb = DEFAULT_DB;
let _authenticatedDb: string | null = null;

function makeRequestId(): string {
  return `odoo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Configure service account credentials for Odoo session auth.
 * Call this once during app initialization.
 */
export function setServiceCredentials(login: string, password: string, databaseName = DEFAULT_DB) {
  if (
    _serviceLogin === login &&
    _servicePassword === password &&
    _configuredDb === databaseName &&
    _authenticated
  ) {
    return;
  }

  _serviceLogin = login;
  _servicePassword = password;
  _configuredDb = databaseName;
  _authenticated = false;
  _uid = null;
  _authenticatedDb = null;
}

/**
 * Check whether service credentials have been configured.
 */
export function hasServiceCredentials(): boolean {
  return !!_serviceLogin && !!_servicePassword;
}

/**
 * Authenticate with Odoo to establish a web session.
 * After this call, React Native's cookie jar holds the session_id cookie,
 * and _uid is set for execute_kw fallback.
 */
async function authenticate(): Promise<boolean> {
  if (_authenticating) return _authenticating;

  _authenticating = (async () => {
    if (!_serviceLogin || !_servicePassword) {
      console.warn('[odooSession] No service credentials configured');
      return false;
    }

    try {
      const baseUrl = await getBaseUrl();
      console.log('[odooSession] Authenticating...');
      const listedDbs = await fetchOdooDatabaseNames(baseUrl);
      const dbCandidates = candidateOdooDatabases(baseUrl, _configuredDb, listedDbs);

      for (const db of dbCandidates) {
        const requestId = makeRequestId();
        const startedAt = Date.now();
        const requestBody = {
          jsonrpc: '2.0',
          params: {
            db,
            login: _serviceLogin,
            password: _servicePassword,
          },
        };

        logInfo('api', 'http_request', buildHttpTraceData({
          phase: 'request',
          channel: 'odoo_auth',
          method: 'POST',
          url: `${baseUrl}/web/session/authenticate`,
          requestId,
          requestHeaders: { 'Content-Type': 'application/json' },
          requestBody,
        }));

        const response = await fetch(`${baseUrl}/web/session/authenticate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include', // ← tells RN to store & send cookies
          body: JSON.stringify(requestBody),
        });

        const text = await response.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        const durationMs = Date.now() - startedAt;
        const authError = parsed?.error?.data?.message || parsed?.error?.message;

        if (response.ok && !authError && parsed?.result?.uid) {
          logInfo('api', 'http_response', buildHttpTraceData({
            phase: 'response',
            channel: 'odoo_auth',
            method: 'POST',
            url: `${baseUrl}/web/session/authenticate`,
            requestId,
            status: response.status,
            durationMs,
            responseBody: parsed,
          }));
          _uid = parsed.result.uid;
          _authenticated = true;
          _authenticatedDb = db;
          console.log(`[odooSession] Authenticated as uid=${_uid}`);
          return true;
        }

        logWarn('api', 'http_error', buildHttpTraceData({
          phase: 'error',
          channel: 'odoo_auth',
          method: 'POST',
          url: `${baseUrl}/web/session/authenticate`,
          requestId,
          status: response.status,
          durationMs,
          responseBody: parsed,
          errorMessage: authError || 'Authentication failed',
        }));

        if (authError !== 'Database not found.') {
          console.warn('[odooSession] Auth error:', authError);
          return false;
        }

        console.warn(`[odooSession] Auth database not found: ${db}`);
      }

      console.warn('[odooSession] Auth failed: no uid in response');
      return false;
    } catch (err) {
      logError('api', 'http_error', buildHttpTraceData({
        phase: 'error',
        channel: 'odoo_auth',
        method: 'POST',
        url: `${await getBaseUrl()}/web/session/authenticate`,
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
      console.warn('[odooSession] Auth error:', err);
      return false;
    } finally {
      _authenticating = null;
    }
  })();

  return _authenticating;
}

/**
 * Ensure we have a valid session. Re-authenticates if needed.
 */
async function ensureSession(): Promise<boolean> {
  if (_authenticated && _uid) return true;
  return authenticate();
}

/**
 * Make an authenticated JSON-RPC call to Odoo.
 *
 * Tries two strategies:
 *   1. /web/dataset/call_kw with cookie jar (credentials: 'include')
 *   2. /jsonrpc with execute_kw (uid + password, no cookies needed)
 *
 * If strategy 1 fails with SessionExpired, falls back to strategy 2.
 */
export async function sessionRpc<T = unknown>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  const hasSession = await ensureSession();
  if (!hasSession) {
    throw new Error('[odooSession] Cannot establish Odoo session');
  }

  const baseUrl = await getBaseUrl();

  // ── Strategy 1: /web/dataset/call_kw with automatic cookie ──
  try {
    const requestId = makeRequestId();
    const startedAt = Date.now();
    const requestBody = {
      jsonrpc: '2.0',
      method: 'call',
      params: { model, method, args, kwargs },
    };

    logInfo('api', 'http_request', buildHttpTraceData({
      phase: 'request',
      channel: 'odoo_call_kw',
      method: 'POST',
      url: `${baseUrl}/web/dataset/call_kw`,
      requestId,
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody,
    }));

    const response = await fetch(`${baseUrl}/web/dataset/call_kw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // ← RN sends session cookie automatically
      body: JSON.stringify(requestBody),
    });

    const text = await response.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const durationMs = Date.now() - startedAt;
    const errName = parsed?.error?.data?.name || '';
    const errMessage = parsed?.error?.data?.message || parsed?.error?.message;

    // Check for session expiry → retry auth once then fall to strategy 2
    if (errName.includes('SessionExpired')) {
      logWarn('api', 'http_error', buildHttpTraceData({
        phase: 'error',
        channel: 'odoo_call_kw',
        method: 'POST',
        url: `${baseUrl}/web/dataset/call_kw`,
        requestId,
        status: response.status,
        durationMs,
        responseBody: parsed,
        errorMessage: errMessage || 'SessionExpired',
      }));
      console.log('[odooSession] Session expired, re-authenticating...');
      _authenticated = false;
      _uid = null;
      const reAuth = await authenticate();
      if (reAuth) {
        // Retry with fresh session cookie
        const retryResp = await fetch(`${baseUrl}/web/dataset/call_kw`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'call',
            params: { model, method, args, kwargs },
          }),
        });
        const retryText = await retryResp.text();
        let retryParsed: any;
        try { retryParsed = JSON.parse(retryText); } catch { retryParsed = null; }

        if (retryParsed && !retryParsed.error) {
          logInfo('api', 'http_response', buildHttpTraceData({
            phase: 'response',
            channel: 'odoo_call_kw_retry',
            method: 'POST',
            url: `${baseUrl}/web/dataset/call_kw`,
            requestId,
            status: retryResp.status,
            durationMs: Date.now() - startedAt,
            responseBody: retryParsed,
          }));
          return retryParsed?.result as T;
        }
        // If retry also failed, fall through to strategy 2
        logWarn('api', 'http_error', buildHttpTraceData({
          phase: 'error',
          channel: 'odoo_call_kw_retry',
          method: 'POST',
          url: `${baseUrl}/web/dataset/call_kw`,
          requestId,
          status: retryResp.status,
          durationMs: Date.now() - startedAt,
          responseBody: retryParsed,
          errorMessage: retryParsed?.error?.data?.message || retryParsed?.error?.message || 'call_kw retry failed',
        }));
        console.warn('[odooSession] call_kw retry failed, trying execute_kw...');
      }
    } else if (parsed && !parsed.error) {
      // Success!
      logInfo('api', 'http_response', buildHttpTraceData({
        phase: 'response',
        channel: 'odoo_call_kw',
        method: 'POST',
        url: `${baseUrl}/web/dataset/call_kw`,
        requestId,
        status: response.status,
        durationMs,
        responseBody: parsed,
      }));
      return parsed.result as T;
    } else if (parsed?.error) {
      // Non-session error — might still be auth related, try strategy 2
      logWarn('api', 'http_error', buildHttpTraceData({
        phase: 'error',
        channel: 'odoo_call_kw',
        method: 'POST',
        url: `${baseUrl}/web/dataset/call_kw`,
        requestId,
        status: response.status,
        durationMs,
        responseBody: parsed,
        errorMessage: errMessage || 'call_kw error',
      }));
      console.warn('[odooSession] call_kw error:', parsed.error?.data?.message || parsed.error?.message);
    }
  } catch (err) {
    logError('api', 'http_error', buildHttpTraceData({
      phase: 'error',
      channel: 'odoo_call_kw',
      method: 'POST',
      url: `${baseUrl}/web/dataset/call_kw`,
      errorMessage: err instanceof Error ? err.message : String(err),
    }));
    console.warn('[odooSession] call_kw fetch error:', err);
  }

  // ── Strategy 2: /jsonrpc with execute_kw (no cookies needed) ──
  // Standard Odoo external API: [db, uid, password, model, method, args, kwargs]
  if (_uid && _servicePassword) {
    console.log(`[odooSession] Falling back to execute_kw for ${model}.${method}`);
    try {
      const requestId = makeRequestId();
      const startedAt = Date.now();
      const requestBody = {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          service: 'object',
          method: 'execute_kw',
          args: [_authenticatedDb || _configuredDb, _uid, _servicePassword, model, method, args, kwargs],
        },
      };

      logInfo('api', 'http_request', buildHttpTraceData({
        phase: 'request',
        channel: 'odoo_execute_kw',
        method: 'POST',
        url: `${baseUrl}/jsonrpc`,
        requestId,
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody,
      }));

      const response = await fetch(`${baseUrl}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const text = await response.text();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const durationMs = Date.now() - startedAt;

      if (parsed?.error) {
        const msg = parsed.error?.data?.message || parsed.error?.message || 'Odoo RPC error';
        logError('api', 'http_error', buildHttpTraceData({
          phase: 'error',
          channel: 'odoo_execute_kw',
          method: 'POST',
          url: `${baseUrl}/jsonrpc`,
          requestId,
          status: response.status,
          durationMs,
          responseBody: parsed,
          errorMessage: msg,
        }));
        throw new Error(msg);
      }

      logInfo('api', 'http_response', buildHttpTraceData({
        phase: 'response',
        channel: 'odoo_execute_kw',
        method: 'POST',
        url: `${baseUrl}/jsonrpc`,
        requestId,
        status: response.status,
        durationMs,
        responseBody: parsed,
      }));
      return parsed?.result as T;
    } catch (err) {
      console.error('[odooSession] execute_kw also failed:', err);
      throw err;
    }
  }

  throw new Error('[odooSession] All authentication strategies exhausted');
}

/**
 * Invalidate the current session (e.g. on logout).
 */
export function clearOdooSession() {
  _authenticated = false;
  _uid = null;
  _authenticating = null;
  _authenticatedDb = null;
}
