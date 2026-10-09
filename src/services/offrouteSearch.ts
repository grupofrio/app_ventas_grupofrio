import { DEFAULT_READ_TIMEOUT_MS, postRest } from './api';
import { loadCurrentEmployeeDayBundle } from './employeeDayBundle';
import {
  buildOffrouteResults,
  matchesOffrouteDirectoryQuery,
  mergeOffrouteSearchResults,
  parseDirectorySearchResponse,
} from './offrouteSearchLogic';
import type { OffrouteCustomerRecord, OffrouteSearchResult } from './offrouteSearchLogic';

export type { OffrouteCustomerRecord, OffrouteLeadRecord, OffrouteSearchResult } from './offrouteSearchLogic';
export { buildOffrouteResults };

const DIRECTORY_SEARCH_PATH = 'gf/logistics/api/employee/directory/search';

async function searchLocalDirectory(query: string): Promise<OffrouteSearchResult[]> {
  const loaded = await loadCurrentEmployeeDayBundle();
  if (!loaded) throw new Error('Prepara los datos del día antes de buscar fuera de ruta.');
  const customers: OffrouteCustomerRecord[] = loaded.record.bundle.directory.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const address = typeof item.address === 'string' ? item.address.trim() : '';
    const zone = typeof item.zone === 'string' ? item.zone.trim() : '';
    const phone = typeof item.phone === 'string' ? item.phone.trim() : '';
    const vat = typeof item.vat === 'string' ? item.vat.trim() : '';
    const rfc = typeof item.rfc === 'string' ? item.rfc.trim() : '';
    if (typeof item.id !== 'number' || item.id <= 0 || !name) return [];
    if (!matchesOffrouteDirectoryQuery(query, { name, address, zone, phone, vat, rfc })) return [];
    return [{
      id: item.id,
      name,
      street: address || undefined,
      city: zone || undefined,
      phone: phone || undefined,
      vat: vat || rfc || undefined,
      partner_latitude: typeof item.latitude === 'number' ? item.latitude : undefined,
      partner_longitude: typeof item.longitude === 'number' ? item.longitude : undefined,
    }];
  });
  return buildOffrouteResults(customers, []);
}

async function searchRemoteDirectory(query: string): Promise<OffrouteSearchResult[]> {
  const payload = await postRest<unknown>(DIRECTORY_SEARCH_PATH, { query, limit: 20 }, {
    timeoutMs: DEFAULT_READ_TIMEOUT_MS,
  });
  return parseDirectorySearchResponse(payload);
}

export async function searchOffrouteEntities(
  query: string,
): Promise<OffrouteSearchResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  let localResults: OffrouteSearchResult[] = [];
  let localError: Error | null = null;
  try {
    localResults = await searchLocalDirectory(q);
  } catch (error) {
    localError = error instanceof Error
      ? error
      : new Error('Prepara los datos del día antes de buscar fuera de ruta.');
  }

  let remoteResults: OffrouteSearchResult[] = [];
  let remoteFailed = false;
  try {
    remoteResults = await searchRemoteDirectory(q);
  } catch {
    remoteFailed = true;
  }

  const merged = mergeOffrouteSearchResults(localResults, remoteResults);
  if (merged.length > 0) return merged;
  if (localError && (remoteFailed || remoteResults.length === 0)) throw localError;
  return [];
}
