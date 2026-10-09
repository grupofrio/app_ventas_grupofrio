import { formatMexicoClock, mexicoDayOf } from '../utils/localDate.ts';

export const PLAZA_WEATHER_REFRESH_MS = 20 * 60 * 1000;
export const BRANCH_WEATHER_PATH = 'gf/logistics/api/employee/weather';

export type PlazaWeatherSource = 'odoo' | 'open-meteo';

export interface PlazaWeatherSnapshot {
  place: string;
  currentC: number;
  maxC: number | null;
  minC: number | null;
  condition: string;
  updatedAt: string;
  source: PlazaWeatherSource;
}

export interface PlazaWeatherCardModel {
  glyph: string;
  temperature: string;
  place: string;
  detail: string;
  updated: string;
}

export type WeatherTarget =
  | { kind: 'coordinates'; label: string; latitude: number; longitude: number }
  | { kind: 'geocode'; label: string; query: string }
  | { kind: 'device'; label: string };

const KNOWN_PLAZAS: Array<{ match: string; label: string; latitude: number; longitude: number }> = [
  { match: 'iguala', label: 'Iguala', latitude: 18.3492, longitude: -99.5397 },
  { match: 'guadalajara', label: 'Guadalajara', latitude: 20.6736, longitude: -103.3444 },
  { match: 'acapulco', label: 'Acapulco', latitude: 16.8531, longitude: -99.8237 },
  { match: 'chilpancingo', label: 'Chilpancingo', latitude: 17.5515, longitude: -99.5006 },
  { match: 'cuernavaca', label: 'Cuernavaca', latitude: 18.9242, longitude: -99.2216 },
  { match: 'puebla', label: 'Puebla', latitude: 19.0414, longitude: -98.2063 },
  { match: 'toluca', label: 'Toluca', latitude: 19.2826, longitude: -99.6557 },
  { match: 'queretaro', label: 'Querétaro', latitude: 20.5888, longitude: -100.3899 },
  { match: 'leon', label: 'León', latitude: 21.125, longitude: -101.686 },
  { match: 'morelia', label: 'Morelia', latitude: 19.705, longitude: -101.194 },
  { match: 'monterrey', label: 'Monterrey', latitude: 25.6866, longitude: -100.3161 },
  { match: 'cdmx', label: 'Ciudad de México', latitude: 19.4326, longitude: -99.1332 },
  { match: 'ciudad de mexico', label: 'Ciudad de México', latitude: 19.4326, longitude: -99.1332 },
];

const CURRENT_KEYS = [
  'current_c',
  'current_temp',
  'current_temperature',
  'temperature_c',
  'temperature',
  'temp_c',
  'temp',
  'temperature_2m',
];
const MAX_KEYS = ['max_c', 'temp_max', 'temperature_max', 'max_temp', 'temperature_2m_max', 'high_c'];
const MIN_KEYS = ['min_c', 'temp_min', 'temperature_min', 'min_temp', 'temperature_2m_min', 'low_c'];
const PLACE_KEYS = ['place', 'city', 'branch_name', 'plaza_name', 'plaza', 'branch', 'location_name'];
const CONDITION_KEYS = ['condition', 'condition_label', 'summary', 'weather_label', 'description'];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function plausibleTemp(value: unknown): number | null {
  const number = readNumber(value);
  if (number === null || number < -40 || number > 60) return null;
  return Math.round(number);
}

function readTemp(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const temp = plausibleTemp(source[key]);
    if (temp !== null) return temp;
  }
  return null;
}

function readText(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function normalizePlaceName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(plaza|cedis|sucursal|bodega|unidad)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function usableHint(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const cleaned = normalizePlaceName(trimmed);
  if (cleaned.length < 3) return null;
  if (/^(ruta|plan|rplan)\b/.test(cleaned)) return null;
  return trimmed;
}

export function conditionFromWeatherCode(code: number): string {
  if (code === 0) return 'Despejado';
  if (code === 1) return 'Mayormente despejado';
  if (code === 2) return 'Parcialmente nublado';
  if (code === 3) return 'Nublado';
  if (code === 45 || code === 48) return 'Niebla';
  if (code >= 51 && code <= 57) return 'Llovizna';
  if (code >= 61 && code <= 67) return 'Lluvia';
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return 'Nieve';
  if (code >= 80 && code <= 82) return 'Chubascos';
  if (code >= 95) return 'Tormenta';
  return 'Clima';
}

function normalizeConditionLabel(value: string): string {
  const cleaned = value.trim();
  const key = normalizePlaceName(cleaned);
  if (key === 'clear' || key === 'sunny') return 'Despejado';
  if (key === 'mainly clear' || key === 'mostly clear') return 'Mayormente despejado';
  if (key === 'partly cloudy' || key === 'partially cloudy') return 'Parcialmente nublado';
  if (key === 'cloudy' || key === 'overcast') return 'Nublado';
  if (key === 'fog' || key === 'mist') return 'Niebla';
  if (key === 'drizzle') return 'Llovizna';
  if (key === 'rain' || key === 'rainy') return 'Lluvia';
  if (key === 'showers') return 'Chubascos';
  if (key === 'snow') return 'Nieve';
  if (key === 'storm' || key === 'thunderstorm') return 'Tormenta';
  return cleaned.slice(0, 48);
}

export function weatherGlyph(condition: string): string {
  const value = normalizePlaceName(condition);
  if (value.includes('torment')) return '⛈️';
  if (value.includes('nieve')) return '❄️';
  if (value.includes('lloviz') || value.includes('lluvia') || value.includes('chubasc')) return '🌧️';
  if (value.includes('niebla')) return '🌫️';
  if (value.includes('parcial') && value.includes('nublado')) return '⛅';
  if (value.includes('nublado')) return '☁️';
  if (value.includes('despej')) return '☀️';
  return '🌤️';
}

export function resolveKnownPlaza(
  hints: Array<string | null | undefined>,
): { label: string; latitude: number; longitude: number } | null {
  for (const hint of hints) {
    const usable = usableHint(hint);
    if (!usable) continue;
    const cleaned = normalizePlaceName(usable);
    const match = KNOWN_PLAZAS.find((plaza) => (
      cleaned === plaza.match || cleaned.startsWith(`${plaza.match} `) || cleaned.endsWith(` ${plaza.match}`) || cleaned.includes(` ${plaza.match} `)
    ));
    if (match) {
      return { label: match.label, latitude: match.latitude, longitude: match.longitude };
    }
  }
  return null;
}

export function geocodeQueryFromHints(hints: Array<string | null | undefined>): string | null {
  for (const hint of hints) {
    const usable = usableHint(hint);
    if (!usable) continue;
    return normalizePlaceName(usable);
  }
  return null;
}

export function displayPlaceFromHints(hints: Array<string | null | undefined>): string {
  for (const hint of hints) {
    const usable = usableHint(hint);
    if (usable) return usable;
  }
  return '';
}

export function resolveWeatherTarget(hints: Array<string | null | undefined>): WeatherTarget {
  const known = resolveKnownPlaza(hints);
  if (known) return { kind: 'coordinates', ...known };
  const query = geocodeQueryFromHints(hints);
  if (query) return { kind: 'geocode', label: displayPlaceFromHints(hints) || query, query };
  return { kind: 'device', label: 'Tu ubicación' };
}

export function readDeviceCoordinates(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } | null {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

export function embeddedBranchWeather(plan: unknown): unknown | null {
  const root = asRecord(plan);
  if (!root) return null;
  for (const key of ['weather', 'branch_weather', 'plaza_weather']) {
    const value = root[key];
    if (value && typeof value === 'object') return value;
  }
  return null;
}

function weatherRecords(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) return [];
  if (root.available === false || root.enabled === false || root.weather_available === false) return [];
  const records = [root];
  for (const key of ['weather', 'branch_weather', 'plaza_weather', 'today', 'current', 'data']) {
    const nested = asRecord(root[key]);
    if (nested) records.push(nested);
  }
  return records;
}

function readDayTemps(payload: Record<string, unknown>, nowIso: string): { maxC: number | null; minC: number | null; condition: string } {
  const groups = [payload.days, payload.forecast, payload.daily_forecast, payload.forecast_days];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) continue;
    const day = mexicoDayOf(Date.parse(nowIso));
    const records = group.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
    const today = records.find((item) => {
      const date = readText(item, ['date', 'day', 'forecast_date']);
      return date.slice(0, 10) === day;
    }) ?? records[0];
    if (!today) continue;
    return {
      maxC: readTemp(today, MAX_KEYS),
      minC: readTemp(today, MIN_KEYS),
      condition: readText(today, CONDITION_KEYS),
    };
  }
  return { maxC: null, minC: null, condition: '' };
}

export function parseBranchWeather(
  payload: unknown,
  fallbackPlace: string,
  nowIso: string,
): PlazaWeatherSnapshot | null {
  const records = weatherRecords(payload);
  if (records.length === 0) return null;
  let currentC: number | null = null;
  let maxC: number | null = null;
  let minC: number | null = null;
  let condition = '';
  let place = '';
  let observedAt = '';
  let weatherCode: number | null = null;
  for (const record of records) {
    if (currentC === null) currentC = readTemp(record, CURRENT_KEYS);
    if (maxC === null) maxC = readTemp(record, MAX_KEYS);
    if (minC === null) minC = readTemp(record, MIN_KEYS);
    if (!condition) condition = readText(record, CONDITION_KEYS);
    if (!place) place = readText(record, PLACE_KEYS);
    if (!observedAt) observedAt = readText(record, ['observed_at', 'updated_at', 'fetched_at', 'as_of']);
    if (weatherCode === null) weatherCode = readNumber(record.weather_code);
    const day = readDayTemps(record, nowIso);
    if (maxC === null) maxC = day.maxC;
    if (minC === null) minC = day.minC;
    if (!condition) condition = day.condition;
  }
  if (currentC === null) return null;
  if (maxC !== null && minC !== null && maxC < minC) {
    const swap = maxC;
    maxC = minC;
    minC = swap;
  }
  const label = normalizeConditionLabel(condition || (weatherCode === null ? 'Clima' : conditionFromWeatherCode(weatherCode)));
  const updatedAt = observedAt && !Number.isNaN(Date.parse(observedAt)) ? new Date(observedAt).toISOString() : nowIso;
  return {
    place: place || fallbackPlace || 'Plaza',
    currentC,
    maxC,
    minC,
    condition: label || 'Clima',
    updatedAt,
    source: 'odoo',
  };
}

export function parseOpenMeteoForecast(
  payload: unknown,
  place: string,
  nowIso: string,
): PlazaWeatherSnapshot | null {
  const root = asRecord(payload);
  const current = root ? asRecord(root.current) : null;
  const currentC = current ? plausibleTemp(current.temperature_2m) : null;
  if (!root || currentC === null) return null;
  const daily = asRecord(root.daily);
  let maxC: number | null = null;
  let minC: number | null = null;
  let dailyCode: number | null = null;
  if (daily) {
    const times = Array.isArray(daily.time) ? daily.time : [];
    const day = mexicoDayOf(Date.parse(nowIso));
    let index = times.findIndex((value) => value === day);
    if (index < 0) index = 0;
    const maxes = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
    const mins = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
    const codes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
    maxC = plausibleTemp(maxes[index]);
    minC = plausibleTemp(mins[index]);
    dailyCode = readNumber(codes[index]);
  }
  const code = readNumber(current?.weather_code) ?? dailyCode;
  return {
    place: place || 'Tu ubicación',
    currentC,
    maxC,
    minC,
    condition: code === null ? 'Clima' : conditionFromWeatherCode(code),
    updatedAt: nowIso,
    source: 'open-meteo',
  };
}

export function parseOpenMeteoPlace(
  payload: unknown,
): { name: string; latitude: number; longitude: number } | null {
  const root = asRecord(payload);
  const results = root && Array.isArray(root.results) ? root.results : [];
  for (const result of results) {
    const record = asRecord(result);
    if (!record) continue;
    const latitude = readNumber(record.latitude);
    const longitude = readNumber(record.longitude);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const country = typeof record.country_code === 'string' ? record.country_code : '';
    if (!name || latitude === null || longitude === null) continue;
    if (country && country !== 'MX') continue;
    return { name, latitude, longitude };
  }
  return null;
}

export function buildOpenMeteoForecastUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code',
    timezone: 'America/Mexico_City',
    forecast_days: '2',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function buildOpenMeteoGeocodingUrl(name: string): string {
  const params = new URLSearchParams({
    name,
    count: '1',
    language: 'es',
    format: 'json',
    countryCode: 'MX',
  });
  return `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
}

export function formatPlazaWeatherCard(snapshot: PlazaWeatherSnapshot): PlazaWeatherCardModel {
  const parts = [snapshot.condition];
  if (snapshot.maxC !== null) parts.push(`Máx ${snapshot.maxC}°`);
  if (snapshot.minC !== null) parts.push(`Mín ${snapshot.minC}°`);
  const clock = formatMexicoClock(snapshot.updatedAt);
  return {
    glyph: weatherGlyph(snapshot.condition),
    temperature: `${snapshot.currentC}°`,
    place: snapshot.place,
    detail: parts.filter((part) => part.trim()).join(' · '),
    updated: clock ? `Actualizado ${clock}` : 'Actualizado',
  };
}

export function isPlazaWeatherFresh(snapshot: PlazaWeatherSnapshot, nowMs: number): boolean {
  const at = Date.parse(snapshot.updatedAt);
  return Number.isFinite(at) && nowMs >= at && nowMs - at < PLAZA_WEATHER_REFRESH_MS;
}

export function weatherPlaceChanged(
  snapshot: PlazaWeatherSnapshot,
  hints: Array<string | null | undefined>,
): boolean {
  const known = resolveKnownPlaza(hints);
  if (!known) return false;
  return normalizePlaceName(snapshot.place) !== normalizePlaceName(known.label);
}

export function isBranchWeatherEndpointMissing(error: unknown): boolean {
  const status = error && typeof error === 'object' && typeof (error as { httpStatus?: unknown }).httpStatus === 'number'
    ? (error as { httpStatus: number }).httpStatus
    : null;
  if (status === 404 || status === 405 || status === 501) return true;
  const message = error instanceof Error ? error.message : '';
  return /not found|no existe|método desconocido|metodo desconocido|unknown method/i.test(message);
}

export function readStoredPlazaWeather(raw: unknown, employeeId: number | null): PlazaWeatherSnapshot | null {
  const record = asRecord(raw);
  if (!record || record.schema !== 1 || record.employeeId !== employeeId) return null;
  const snapshot = asRecord(record.snapshot);
  if (!snapshot) return null;
  const currentC = plausibleTemp(snapshot.currentC);
  const place = typeof snapshot.place === 'string' ? snapshot.place.trim() : '';
  const condition = typeof snapshot.condition === 'string' ? snapshot.condition.trim() : '';
  const updatedAt = typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : '';
  const source = snapshot.source === 'odoo' || snapshot.source === 'open-meteo' ? snapshot.source : null;
  if (currentC === null || !place || !condition || !updatedAt || !source) return null;
  if (Number.isNaN(Date.parse(updatedAt))) return null;
  return {
    place,
    currentC,
    maxC: plausibleTemp(snapshot.maxC),
    minC: plausibleTemp(snapshot.minC),
    condition,
    updatedAt,
    source,
  };
}
