import { postRest } from './api';
import type { OffrouteLeadRecord } from './offrouteSearchLogic';

/** The employee Bearer determines company/plaza; never send a client domain. */
export async function searchFieldLeads(query: string): Promise<OffrouteLeadRecord[]> {
  const result = await postRest<any>('gf/logistics/api/employee/lead/search', { query: query.trim() });
  const rows: unknown = result?.data?.leads ?? result?.leads;
  if (!Array.isArray(rows)) throw new Error('No se pudo confirmar la búsqueda de prospectos.');
  return rows.filter((row): row is OffrouteLeadRecord =>
    row !== null && typeof row === 'object' && Number.isInteger(row.id) && row.id > 0 && typeof row.name === 'string');
}
