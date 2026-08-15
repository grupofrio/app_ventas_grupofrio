import { postRest } from './api';
import { buildOffrouteResults } from './offrouteSearchLogic';
import type { OffrouteCustomerRecord, OffrouteLeadRecord, OffrouteSearchResult } from './offrouteSearchLogic';

const EMPLOYEE_API_BASE = '/gf/logistics/api/employee';

export type { OffrouteCustomerRecord, OffrouteLeadRecord, OffrouteSearchResult } from './offrouteSearchLogic';
export { buildOffrouteResults };

interface EmployeeDirectoryResponse {
  ok: true;
  message: string;
  data: {
    customers: OffrouteCustomerRecord[];
    leads: OffrouteLeadRecord[];
  };
}

export async function searchOffrouteEntities(
  query: string,
): Promise<OffrouteSearchResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const response = await postRest<EmployeeDirectoryResponse>(
    `${EMPLOYEE_API_BASE}/directory/search`,
    { query: q, limit: 20 },
  );
  if (!response || response.ok !== true || !response.data
    || !Array.isArray(response.data.customers) || !Array.isArray(response.data.leads)) {
    throw new Error('La respuesta del directorio no cumple el contrato de empleado.');
  }
  return buildOffrouteResults(response.data.customers, response.data.leads);
}
