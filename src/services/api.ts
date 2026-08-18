/**
 * HTTP helpers for KOLD Field.
 * Login and REST transports use fetch on Android
 * to avoid native XHR failures that surfaced as generic "Network Error".
 */

import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { deleteAllAuthCredentialKeys, replaceAuthCredentialValues } from './authCredentialCleanup';
import { logError, logInfo } from '../utils/logger';
import { buildHttpTraceData } from '../utils/httpDebug';
import { unwrapRestResult } from '../utils/apiResult';
import {
  getApiErrorMessage,
  getApiErrorCode,
  hasApiErrorFlag,
  makeApiResponseError,
  makeApiTransportError,
} from './apiRequestError';
import { readPostRestResponseText } from './postRestResponse';
import { createUuidV4 } from '../utils/clientEvent';

const STORE_KEYS = {
  BASE_URL: 'kf_base_url',
  GF_TOKEN: 'kf_gf_token',
  SESSION_ID: 'kf_employee_session_id',
} as const;

const PUBLIC_DEFAULT_BASE_URL = (process.env as Record<string, string | undefined>)[
  'EXPO_PUBLIC_KF_DEFAULT_BASE_URL'
]?.trim().replace(/\/+$/, '');

export const DEFAULT_BASE_URL = PUBLIC_DEFAULT_BASE_URL || 'https://grupofrio-gf.odoo.com';
export const DEFAULT_FETCH_TIMEOUT_MS = 45_000;
/**
 * Perf Fase 1B: timeout corto para LECTURAS (getRest). En red muerta, una
 * lectura cacheable no debe colgar 45s — falla rápido (10s) y el llamador usa
 * caché/fallback. Las mutaciones REST (venta, pago, cierre)
 * conservan el timeout conservador de 45s. No oculta errores: el timeout sigue
 * lanzando y el llamador lo maneja.
 */
export const DEFAULT_READ_TIMEOUT_MS = 10_000;
/**
 * Timeout para handshakes de autenticacion (login, /web/session/authenticate).
 * Antes corrian con fetch SIN timeout: en red degradada el login colgaba
 * indefinidamente (pendiente de auditoria julio).
 */
export const AUTH_TIMEOUT_MS = 15_000;

let _baseUrl = DEFAULT_BASE_URL;

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, '').trim();
}

function safeParseJson(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

function makeRequestId(): string {
  return `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeLoggedHttpError(message: string): Error & { __alreadyLogged: true } {
  const error = new Error(message) as Error & { __alreadyLogged: true };
  error.__alreadyLogged = true;
  return error;
}

function makeTimeoutError(timeoutMs: number): Error & { code: 'timeout' } {
  const seconds = Math.round(timeoutMs / 1000);
  const error = new Error(`Tiempo de espera agotado despues de ${seconds}s`) as Error & {
    code: 'timeout';
  };
  error.code = 'timeout';
  return error;
}

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    // Solo en error se desarma el timer: la petición ya terminó.
    clearTimeout(timeoutId);
    if (timedOut) {
      throw makeTimeoutError(timeoutMs);
    }
    throw error;
  }
  // P2 Codex #66: el timer NO se desarma al resolver fetch — los headers
  // pueden llegar y el BODY quedarse colgado (response.json()/text() leían
  // sin límite). El timer queda armado el timeoutMs completo: si el body
  // sigue abierto al vencer, abort() corta el stream y la lectura rechaza;
  // si ya se consumió, abortar una petición terminada es un no-op inocuo.
}

async function buildAbsoluteUrl(url: string): Promise<string> {
  if (url.startsWith('http')) return url;
  const baseUrl = await getBaseUrl();
  return `${baseUrl}/${url.replace(/^\//, '')}`;
}

async function buildHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const gfToken = await SecureStore.getItemAsync(STORE_KEYS.GF_TOKEN);

  if (gfToken) {
    headers.Authorization = `Bearer ${sanitizeHeaderValue(gfToken)}`;
  }

  return headers;
}

export async function setBaseUrl(url: string) {
  _baseUrl = url.replace(/\/+$/, '') || DEFAULT_BASE_URL;
  await SecureStore.setItemAsync(STORE_KEYS.BASE_URL, _baseUrl);
}

export async function getBaseUrl(): Promise<string> {
  if (_baseUrl) return _baseUrl;
  _baseUrl = (await SecureStore.getItemAsync(STORE_KEYS.BASE_URL)) || DEFAULT_BASE_URL;
  return _baseUrl;
}

export async function setAuthTokens(gfToken: string, sessionId = createUuidV4()) {
  await replaceAuthCredentialValues([
    { key: STORE_KEYS.GF_TOKEN, value: gfToken },
    // Clear the no-longer-used credential before committing the new scope.
    { key: 'kf_api_key', value: null },
    // SESSION_ID is the final pointer that makes the replacement scope active.
    { key: STORE_KEYS.SESSION_ID, value: sessionId },
  ], {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    remove: (key) => SecureStore.deleteItemAsync(key),
  });
}

export async function clearAuthTokens() {
  _baseUrl = DEFAULT_BASE_URL;
  await deleteAllAuthCredentialKeys([
    'kf_api_key',
    STORE_KEYS.GF_TOKEN,
    STORE_KEYS.SESSION_ID,
    STORE_KEYS.BASE_URL,
  ], (key) => SecureStore.deleteItemAsync(key));
}

/**
 * Stable only for the authenticated employee session currently held in
 * SecureStore. Legacy restored sessions get a fresh scope before mutations.
 */
export async function getAuthSessionId(): Promise<string | null> {
  const [gfToken, storedSessionId] = await Promise.all([
    SecureStore.getItemAsync(STORE_KEYS.GF_TOKEN),
    SecureStore.getItemAsync(STORE_KEYS.SESSION_ID),
  ]);
  if (!gfToken) return null;
  if (storedSessionId) return storedSessionId;
  const sessionId = createUuidV4();
  await SecureStore.setItemAsync(STORE_KEYS.SESSION_ID, sessionId);
  return sessionId;
}

/** Employee Bearer credential for bounded first-party REST transports. */
export async function getEmployeeBearerToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(STORE_KEYS.GF_TOKEN);
  return token ? sanitizeHeaderValue(token) : null;
}

export async function hasAuthTokens(): Promise<boolean> {
  const [gfToken] = await Promise.all([
    SecureStore.getItemAsync(STORE_KEYS.GF_TOKEN),
    SecureStore.deleteItemAsync('kf_api_key'),
  ]);
  return !!gfToken;
}

/**
 * Create configured Axios instance.
 * Interceptor auto-adds auth headers from SecureStore.
 */
export function createApiClient(): AxiosInstance {
  const client = axios.create({
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  // Request interceptor: add auth headers + base URL
  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const baseUrl = await getBaseUrl();
    if (baseUrl && config.url && !config.url.startsWith('http')) {
      config.url = `${baseUrl}/${config.url.replace(/^\//, '')}`;
    }

    const gfToken = await SecureStore.getItemAsync(STORE_KEYS.GF_TOKEN);

    if (gfToken) {
      config.headers.set('Authorization', `Bearer ${sanitizeHeaderValue(gfToken)}`);
    }

    return config;
  });

  // Response interceptor: extract Odoo result
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      // Log for debugging but don't crash
      console.warn('[API Error]', error?.response?.status, error?.message);
      return Promise.reject(error);
    }
  );

  return client;
}

// Singleton instance
export const api = createApiClient();

// ═══════════════════════════════════════════════════════════════
// PROTOCOL HELPERS — Use these instead of raw api.post()
// ═══════════════════════════════════════════════════════════════

/**
 * POST to a REST endpoint (e.g. gf/logistics/api/employee/*).
 * Sends payload as-is, no JSON-RPC wrapping.
 * Response data is returned directly — caller decides how to parse.
 */
export async function postRest<T = any>(
  url: string,
  data: Record<string, unknown> = {},
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const absoluteUrl = await buildAbsoluteUrl(url);
  const headers = await buildHeaders();
  const requestId = makeRequestId();
  const startedAt = Date.now();

  logInfo('api', 'http_request', buildHttpTraceData({
    phase: 'request',
    channel: 'rest',
    method: 'POST',
    url: absoluteUrl,
    requestId,
    requestHeaders: headers,
    requestBody: data,
  }));

  let responseStatus: number | undefined;

  try {
    const response = await fetchWithTimeout(absoluteUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    }, options.timeoutMs);
    responseStatus = response.status;

    const text = await readPostRestResponseText(response);
    const parsed = safeParseJson(text);
    let resultPayload: T | undefined;
    const durationMs = Date.now() - startedAt;
    let errorMessage: string | undefined;
    let resultError: unknown;

    try {
      resultPayload = unwrapRestResult(parsed, response.status) as T;
    } catch (error) {
      resultError = error;
      errorMessage = getApiErrorMessage(error, 'Error de solicitud');
    }

    const trace = buildHttpTraceData({
      phase: response.ok && !errorMessage ? 'response' : 'error',
      channel: 'rest',
      method: 'POST',
      url: absoluteUrl,
      requestId,
      status: response.status,
      durationMs,
      responseBody: parsed,
      errorMessage: errorMessage || (
        response.ok
          ? undefined
          : (parsed?.error?.data?.message || parsed?.message || `HTTP ${response.status}`)
      ),
    });

    if (response.ok && !errorMessage) {
      logInfo('api', 'http_response', trace);
    } else {
      logError('api', 'http_error', trace);
      const msg = errorMessage || parsed?.error?.data?.message || parsed?.message || `HTTP ${response.status}`;
      const responseErrorStatus = typeof (resultError as { httpStatus?: unknown } | undefined)?.httpStatus === 'number'
        ? (resultError as { httpStatus: number }).httpStatus
        : response.status;
      throw makeApiResponseError(resultError, msg, responseErrorStatus);
    }

    return resultPayload as T;
  } catch (error) {
    if (hasApiErrorFlag(error, '__alreadyLogged')) {
      throw error;
    }
    const requestError = responseStatus !== undefined && getApiErrorCode(error) === 'invalid_response'
      ? error as ReturnType<typeof makeApiResponseError>
      : responseStatus === undefined
        ? makeApiTransportError(error)
        : makeApiResponseError(error, 'Error de solicitud', responseStatus);
    logError('api', 'http_error', buildHttpTraceData({
      phase: 'error',
      channel: 'rest',
      method: 'POST',
      url: absoluteUrl,
      requestId,
      durationMs: Date.now() - startedAt,
      errorMessage: getApiErrorMessage(requestError, 'Error de solicitud'),
    }));
    throw requestError;
  }
}

/**
 * GET a REST endpoint (e.g. pwa-ruta/vehicle-checklist?route_plan_id=N
 * or pwa-ruta/consignment/my-active?partner_id=N).
 * Mirrors postRest envelope handling (unwrapRestResult throws on ok===false).
 */
export async function getRest<T = any>(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const absoluteUrl = await buildAbsoluteUrl(url);
  const headers = await buildHeaders();
  const requestId = makeRequestId();
  const startedAt = Date.now();

  logInfo('api', 'http_request', buildHttpTraceData({
    phase: 'request',
    channel: 'rest',
    method: 'GET',
    url: absoluteUrl,
    requestId,
    requestHeaders: headers,
  }));

  try {
    const response = await fetchWithTimeout(absoluteUrl, {
      method: 'GET',
      headers,
    }, options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS);

    const text = await response.text();
    const parsed = safeParseJson(text);
    let resultPayload: T | undefined;
    const durationMs = Date.now() - startedAt;
    let errorMessage: string | undefined;

    try {
      resultPayload = unwrapRestResult(parsed, response.status) as T;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    const trace = buildHttpTraceData({
      phase: response.ok && !errorMessage ? 'response' : 'error',
      channel: 'rest',
      method: 'GET',
      url: absoluteUrl,
      requestId,
      status: response.status,
      durationMs,
      responseBody: parsed,
      errorMessage: errorMessage || (
        response.ok
          ? undefined
          : (parsed?.error?.data?.message || parsed?.message || `HTTP ${response.status}`)
      ),
    });

    if (response.ok && !errorMessage) {
      logInfo('api', 'http_response', trace);
    } else {
      logError('api', 'http_error', trace);
      const msg = errorMessage || parsed?.error?.data?.message || parsed?.message || `HTTP ${response.status}`;
      throw makeLoggedHttpError(msg);
    }

    return resultPayload as T;
  } catch (error) {
    if ((error as { __alreadyLogged?: boolean })?.__alreadyLogged) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    logError('api', 'http_error', buildHttpTraceData({
      phase: 'error',
      channel: 'rest',
      method: 'GET',
      url: absoluteUrl,
      requestId,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
    }));
    throw error;
  }
}
