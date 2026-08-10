import { odooRead, odooRpc } from './odooRpc';
import {
  buildOffrouteResults,
  buildCustomerSearchDomain,
  readCustomersWithFieldFallback,
  resolveCustomersWithFallback,
} from './offrouteSearchLogic';
import type {
  OffrouteCustomerRecord,
  OffrouteLeadRecord,
  OffrouteSearchResult,
} from './offrouteSearchLogic';

const LEAD_FIELDS = ['id', 'name', 'partner_name', 'phone', 'mobile', 'email_from', 'street', 'city', 'partner_id'];

export type { OffrouteCustomerRecord, OffrouteLeadRecord, OffrouteSearchResult } from './offrouteSearchLogic';
export { buildOffrouteResults, buildCustomerSearchDomain };

type OffrouteSearchOptions = {
  analyticPlazaId?: number | null;
  companyId?: number | null;
};

/**
 * Append an analytic-plaza filter for res.partner.
 *
 * Field is `x_analytic_un_id` (Studio many2one → account.analytic.account).
 * Naming caveat: a pesar del nombre `_un_`, este campo está acotado en
 * `gf_saleops/models/res_partner.py` con `domain=[('plan_id', '=', 2)]`,
 * es decir, apunta a la dimensión PLAZA (Iguala, GDL, CDMX…), NO a la
 * dimensión "Unidad de Negocio" (Hub, CEDIS, Planta…) que vive en plan 12.
 * Las IDs aquí coinciden con `hr.employee.x_analytic_account_id`, por lo
 * que pasar la plaza del empleado como filtro funciona correctamente.
 * crm.lead NO tiene este campo — los leads no se filtran por plaza.
 */
async function searchCustomers(domain: unknown[]) {
  return await readCustomersWithFieldFallback({
    rpc: (fields) => odooRpc('res.partner', 'search_read', [domain], {
      fields,
      limit: 20,
      order: 'name asc',
    }),
    read: (fields) => odooRead('res.partner', domain, fields, 20, 0, 'name asc'),
  });
}

async function searchLeads(domain: unknown[]): Promise<OffrouteLeadRecord[]> {
  try {
    return await odooRpc<OffrouteLeadRecord[]>('crm.lead', 'search_read', [domain], {
      fields: LEAD_FIELDS,
      limit: 20,
      order: 'name asc',
    });
  } catch {
    return await odooRead<OffrouteLeadRecord>('crm.lead', domain, LEAD_FIELDS, 20, 0, 'name asc');
  }
}

export async function searchOffrouteEntities(
  query: string,
  options: OffrouteSearchOptions = {},
): Promise<OffrouteSearchResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  // crm.lead does NOT have x_analytic_un_id — no analytic filter applied.
  const leadDomain = [
    '|', '|', '|', '|',
    ['name', 'ilike', q],
    ['partner_name', 'ilike', q],
    ['phone', 'ilike', q],
    ['mobile', 'ilike', q],
    ['email_from', 'ilike', q],
  ];

  // Clientes con RED DE SEGURIDAD (fallback sin plaza pero SIEMPRE acotado por
  // compañía — ver resolveCustomersWithFallback) y leads en paralelo. Un fallo de
  // cualquiera degrada a lista vacía sin romper el otro.
  const [customers, leads] = await Promise.all([
    resolveCustomersWithFallback({
      query: q,
      analyticPlazaId: options.analyticPlazaId,
      companyId: options.companyId,
      runSearch: searchCustomers,
    }).catch(() => [] as OffrouteCustomerRecord[]),
    searchLeads(leadDomain).catch(() => [] as OffrouteLeadRecord[]),
  ]);

  return buildOffrouteResults(customers, leads);
}
