import { getRest } from './api';
import { storeLoad, storeSave } from '../persistence/storage';
import {
  branchWeatherRequestPath,
  buildOpenMeteoForecastUrl,
  buildOpenMeteoGeocodingUrl,
  displayPlaceFromHints,
  isPlazaWeatherFresh,
  parseBranchWeather,
  parseOpenMeteoForecast,
  parseOpenMeteoPlace,
  readDeviceCoordinates,
  readStoredPlazaWeather,
  resolveWeatherTarget,
  weatherPlaceChanged,
  type PlazaWeatherSnapshot,
} from './plazaWeatherLogic.ts';

const CACHE_KEY = 'cache:plaza-weather';
const READ_TIMEOUT_MS = 8_000;

let inFlight: Promise<PlazaWeatherSnapshot | null> | null = null;

export interface RefreshPlazaWeatherInput {
  employeeId: number | null;
  isOnline: boolean;
  hints: Array<string | null | undefined>;
  deviceLatitude?: number | null;
  deviceLongitude?: number | null;
  plan?: unknown;
  planId?: number | null;
  force?: boolean;
  nowMs?: number;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

async function remember(employeeId: number | null, snapshot: PlazaWeatherSnapshot): Promise<void> {
  await storeSave(CACHE_KEY, { schema: 1, employeeId, snapshot });
}

export async function loadCachedPlazaWeather(employeeId: number | null): Promise<PlazaWeatherSnapshot | null> {
  const raw = await storeLoad<unknown>(CACHE_KEY);
  return readStoredPlazaWeather(raw, employeeId);
}

async function refreshPlazaWeatherOnce(input: RefreshPlazaWeatherInput): Promise<PlazaWeatherSnapshot | null> {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cached = await loadCachedPlazaWeather(input.employeeId);
  const placeChanged = cached ? weatherPlaceChanged(cached, input.hints) : false;
  if (cached && !input.force && !placeChanged && isPlazaWeatherFresh(cached, nowMs)) return cached;
  if (!input.isOnline) return cached;

  const fallbackPlace = displayPlaceFromHints(input.hints);

  // GET gf.weather.daily.v1. 401/403/404/409/422, 5xx and network errors
  // fall through to Open-Meteo. weather_available:false parses as null.
  try {
    const payload = await getRest<unknown>(branchWeatherRequestPath(), { timeoutMs: READ_TIMEOUT_MS });
    const snapshot = parseBranchWeather(payload, fallbackPlace, nowIso);
    if (snapshot) {
      await remember(input.employeeId, snapshot);
      return snapshot;
    }
  } catch {
    // Open-Meteo below. Do not surface the HTTP error on the home card.
  }

  const target = resolveWeatherTarget(input.hints);
  let label = target.label;
  let latitude: number | null = target.kind === 'coordinates' ? target.latitude : null;
  let longitude: number | null = target.kind === 'coordinates' ? target.longitude : null;
  if (target.kind === 'geocode') {
    try {
      const place = parseOpenMeteoPlace(await fetchJson(buildOpenMeteoGeocodingUrl(target.query)));
      if (place) {
        latitude = place.latitude;
        longitude = place.longitude;
        label = target.label || place.name;
      }
    } catch {
      latitude = null;
      longitude = null;
    }
  }
  if (latitude === null || longitude === null) {
    const device = readDeviceCoordinates(input.deviceLatitude, input.deviceLongitude);
    if (!device) return cached;
    latitude = device.latitude;
    longitude = device.longitude;
    label = label || 'Tu ubicación';
  }

  try {
    const snapshot = parseOpenMeteoForecast(
      await fetchJson(buildOpenMeteoForecastUrl(latitude, longitude)),
      label,
      nowIso,
    );
    if (!snapshot) return cached;
    await remember(input.employeeId, snapshot);
    return snapshot;
  } catch {
    return cached;
  }
}

export function refreshPlazaWeather(input: RefreshPlazaWeatherInput): Promise<PlazaWeatherSnapshot | null> {
  if (inFlight && !input.force) return inFlight;
  const flight = refreshPlazaWeatherOnce(input).finally(() => {
    if (inFlight === flight) inFlight = null;
  });
  inFlight = flight;
  return flight;
}
