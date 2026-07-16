import { searchEmployeeDirectory } from './employeeData';
import { buildOffrouteResults, normalizeOffrouteDirectoryRecords } from './offrouteSearchLogic';
import type {
  OffrouteSearchResult,
} from './offrouteSearchLogic';

export type { OffrouteCustomerRecord, OffrouteLeadRecord, OffrouteSearchResult } from './offrouteSearchLogic';
export { buildOffrouteResults };

type OffrouteSearchOptions = {
  analyticPlazaId?: number | null;
};

export async function searchOffrouteEntities(
  query: string,
  _options: OffrouteSearchOptions = {},
): Promise<OffrouteSearchResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const { customers, leads } = await searchEmployeeDirectory(q);
  const directory = normalizeOffrouteDirectoryRecords(customers, leads);
  return buildOffrouteResults(directory.customers, directory.leads);
}
