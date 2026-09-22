import { loadCurrentEmployeeDayBundle } from './employeeDayBundle';
import { buildOffrouteResults, matchesOffrouteDirectoryQuery } from './offrouteSearchLogic';
import type { OffrouteCustomerRecord, OffrouteLeadRecord, OffrouteSearchResult } from './offrouteSearchLogic';

export type { OffrouteCustomerRecord, OffrouteLeadRecord, OffrouteSearchResult } from './offrouteSearchLogic';
export { buildOffrouteResults };

export async function searchOffrouteEntities(
  query: string,
): Promise<OffrouteSearchResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const loaded = await loadCurrentEmployeeDayBundle();
  if (!loaded) throw new Error('Prepara los datos del día antes de buscar fuera de ruta.');
  const customers: OffrouteCustomerRecord[] = loaded.record.bundle.directory.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const address = typeof item.address === 'string' ? item.address.trim() : '';
    const zone = typeof item.zone === 'string' ? item.zone.trim() : '';
    if (typeof item.id !== 'number' || item.id <= 0 || !name) return [];
    if (!matchesOffrouteDirectoryQuery(q, { name, address, zone })) return [];
    return [{
      id: item.id,
      name,
      street: address || undefined,
      city: zone || undefined,
      partner_latitude: typeof item.latitude === 'number' ? item.latitude : undefined,
      partner_longitude: typeof item.longitude === 'number' ? item.longitude : undefined,
    }];
  });
  return buildOffrouteResults(customers.slice(0, 20), []);
}
