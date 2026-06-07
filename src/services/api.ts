/**
 * HTTP helpers for KOLD Field.
 * Login still uses Axios, but postRest/postRpc use fetch on Android
 * to avoid native XHR failures that surfaced as generic "Network Error".
 */

import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { logError, logInfo } from '../utils/logger';
import { buildHttpTraceData } from '../utils/httpDebug';
import { unwrapRestResult } from '../utils/apiResult';
import { detectFunctionalErrorMessage } from '../utils/rpcEnvelope';

const STORE_KEYS = {
  BASE_URL: 'kf_base_url',
  API_KEY: 'kf_api_key',
  GF_TOKEN: 'kf_gf_token',
} as const;

export const DEFAULT_BASE_URL = 'https://grupofrio.odoo.com';
export const DEFAULT_FETCH_TIMEOUT_MS = 45_000;

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

async function fetchWithTimeout(
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
    if (timedOut) {
      throw makeTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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

  const apiKey = await SecureStore.getItemAsync(STORE_KEYS.API_KEY);
  const gfToken = await SecureStore.getItemAsync(STORE_KEYS.GF_TOKEN);

  if (apiKey) {
    headers['Api-Key'] = sanitizeHeaderValue(apiKey);
  }
  if (gfToken) {
    headers['X-GF-Employee-Token'] = sanitizeHeaderValue(gfToken);
    // gf_salesops guard expects X-GF-Token (different from logistics).
    // Send the same token under both names so both auth systems work.
    headers['X-GF-Token'] = sanitizeHeaderValue(gfToken);
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

export async function setAuthTokens(apiKey: string, gfToken: string) {
  await SecureStore.setItemAsync(STORE_KEYS.API_KEY, apiKey);
  await SecureStore.setItemAsync(STORE_KEYS.GF_TOKEN, gfToken);
}

export async function clearAuthTokens() {
  _baseUrl = DEFAULT_BASE_URL;
  await SecureStore.deleteItemAsync(STORE_KEYS.API_KEY);
  await SecureStore.deleteItemAsync(STORE_KEYS.GF_TOKEN);
  await SecureStore.deleteItemAsync(STORE_KEYS.BASE_URL);
}

export async function hasAuthTokens(): Promise<boolean> {
  const [apiKey, gfToken] = await Promise.all([
    SecureStore.getItemAsync(STORE_KEYS.API_KEY),
    SecureStore.getItemAsync(STORE_KEYS.GF_TOKEN),
  ]);

  return !!apiKey && !!gfToken;
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

    const apiKey = await SecureStore.getItemAsync(STORE_KEYS.API_KEY);
    const gfToken = await SecureStore.getItemAsync(STORE_KEYS.GF_TOKEN);

    if (apiKey) {
      config.headers.set('Api-Key', sanitizeHeaderValue(apiKey));
    }
    if (gfToken) {
      config.headers.set('X-GF-Employee-Token', sanitizeHeaderValue(gfToken));
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

  try {
    const response = await fetchWithTimeout(absoluteUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    }, options.timeoutMs);

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
      method: 'POST',
      url: absoluteUrl,
      requestId,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
    }));
    throw error;
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
    }, options.timeoutMs);

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

/**
 * POST to an Odoo JSON-RPC endpoint (e.g. /jsonrpc, /get_records, /api/create_update).
 * Wraps params in { jsonrpc: '2.0', params: {...} }.
 * Returns the .result from the JSON-RPC response.
 */
export async function postRpc<T = any>(
  url: string,
  params: Record<string, unknown> = {},
  options: { timeoutMs?: number; allowFunctionalErrorResult?: boolean } = {},
): Promise<T> {
  const absoluteUrl = await buildAbsoluteUrl(url);
  const headers = await buildHeaders();
  const requestId = makeRequestId();
  const requestBody = {
    jsonrpc: '2.0',
    params,
  };
  const startedAt = Date.now();

  logInfo('api', 'http_request', buildHttpTraceData({
    phase: 'request',
    channel: 'rpc',
    method: 'POST',
    url: absoluteUrl,
    requestId,
    requestHeaders: headers,
    requestBody,
  }));

  try {
    const response = await fetchWithTimeout(absoluteUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    }, options.timeoutMs);

    const text = await response.text();
    const parsed = safeParseJson(text);
    const durationMs = Date.now() - startedAt;
    // Native Odoo error channel (parsed.error.*) — surfaces ORM/server crashes.
    const odooErrMsg = !response.ok
      ? (parsed?.error?.data?.message || parsed?.error?.message || `HTTP ${response.status}`)
      : (parsed?.error?.data?.message || parsed?.error?.message);
    // BLD-20260505-RPCENVELOPE: detect functional failure carried inside
    // result envelope ({ ok:false, status>=400, case<0, error:"..." }).
    // Without this the GPS batch (and any other postRpc('/api/create_update'))
    // would treat HTTP 200 + ok:false as success and silently mark items done.
    const functionalErr = !odooErrMsg
      ? detectFunctionalErrorMessage(parsed?.result, { httpStatus: response.status })
      : null;
    const errMsg = odooErrMsg || (options.allowFunctionalErrorResult ? null : functionalErr);

    const trace = buildHttpTraceData({
      phase: errMsg ? 'error' : 'response',
      channel: 'rpc',
      method: 'POST',
      url: absoluteUrl,
      requestId,
      status: response.status,
      durationMs,
      responseBody: parsed,
      errorMessage: errMsg ?? undefined,
    });

    if (errMsg) {
      logError('api', 'http_error', trace);
      throw makeLoggedHttpError(errMsg);
    }

    logInfo('api', 'http_response', trace);
    return parsed?.result as T;
  } catch (error) {
    if ((error as { __alreadyLogged?: boolean })?.__alreadyLogged) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    logError('api', 'http_error', buildHttpTraceData({
      phase: 'error',
      channel: 'rpc',
      method: 'POST',
      url: absoluteUrl,
      requestId,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
    }));
    throw error;
  }
}

/**
 * POST to the legacy /jsonrpc endpoint using method: "call".
 */
export async function postJsonRpc<T = any>(
  url: string,
  params: Record<string, unknown> = {},
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const absoluteUrl = await buildAbsoluteUrl(url);
  const headers = await buildHeaders();
  const requestId = makeRequestId();
  const requestBody = {
    jsonrpc: '2.0',
    method: 'call',
    params,
  };
  const startedAt = Date.now();

  logInfo('api', 'http_request', buildHttpTraceData({
    phase: 'request',
    channel: 'jsonrpc',
    method: 'POST',
    url: absoluteUrl,
    requestId,
    requestHeaders: headers,
    requestBody,
  }));

  try {
    const response = await fetchWithTimeout(absoluteUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    }, options.timeoutMs);

    const text = await response.text();
    const parsed = safeParseJson(text);
    const durationMs = Date.now() - startedAt;
    const odooErrMsg = !response.ok
      ? (parsed?.error?.data?.message || parsed?.error?.message || `HTTP ${response.status}`)
      : (parsed?.error?.data?.message || parsed?.error?.message);
    // Same envelope detection as postRpc — see BLD-20260505-RPCENVELOPE.
    const functionalErr = !odooErrMsg
      ? detectFunctionalErrorMessage(parsed?.result, { httpStatus: response.status })
      : null;
    const errMsg = odooErrMsg || functionalErr;

    const trace = buildHttpTraceData({
      phase: errMsg ? 'error' : 'response',
      channel: 'jsonrpc',
      method: 'POST',
      url: absoluteUrl,
      requestId,
      status: response.status,
      durationMs,
      responseBody: parsed,
      errorMessage: errMsg ?? undefined,
    });

    if (errMsg) {
      logError('api', 'http_error', trace);
      throw makeLoggedHttpError(errMsg);
    }

    logInfo('api', 'http_response', trace);
    return parsed?.result as T;
  } catch (error) {
    if ((error as { __alreadyLogged?: boolean })?.__alreadyLogged) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    logError('api', 'http_error', buildHttpTraceData({
      phase: 'error',
      channel: 'jsonrpc',
      method: 'POST',
      url: absoluteUrl,
      requestId,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
    }));
    throw error;
  }
}
