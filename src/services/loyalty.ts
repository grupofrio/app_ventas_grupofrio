/**
 * Programa de Lealtad — lectura desde Odoo (wiring del fetch).
 *
 * Backend (verificado): NO usa el módulo nativo `loyalty.program/card/reward`.
 * El esquema es custom (`gf_partner_loyalty` + cron `gf_w14_loyalty_engine`) y
 * vive como campos de `res.partner` (ver loyaltyLogic.ts). NO hay endpoint
 * dedicado ni modelo de redención → MVP de SOLO LECTURA.
 *
 * Se lee vía `odooRpc('res.partner','search_read')` (sesión Odoo autenticada),
 * el mismo camino que pricelist.ts — `/get_records` corre como público y no lee
 * res.partner de forma confiable. Sin cambios de backend.
 */

import { odooRpc } from './odooRpc';
import {
  parsePartnerLoyalty,
  PARTNER_LOYALTY_FIELDS,
  type PartnerLoyalty,
} from './loyaltyLogic';

export type { LoyaltyLevel, PartnerLoyalty, LoyaltyLevelInfo } from './loyaltyLogic';
export {
  parsePartnerLoyalty,
  hasLoyaltyData,
  describeLoyaltyLevel,
  PARTNER_LOYALTY_FIELDS,
} from './loyaltyLogic';

/**
 * Lee la lealtad de un cliente desde Odoo (search_read, sesión autenticada).
 * Devuelve null si no se encuentra el partner. Lanza si la sesión/red falla
 * (el caller muestra error/offline). Solo lectura.
 */
export async function fetchPartnerLoyalty(partnerId: number): Promise<PartnerLoyalty | null> {
  if (!partnerId || partnerId <= 0) return null;
  const rows = await odooRpc<Array<Record<string, unknown>>>(
    'res.partner',
    'search_read',
    [[['id', '=', partnerId]]],
    { fields: PARTNER_LOYALTY_FIELDS, limit: 1 },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return parsePartnerLoyalty(row);
}
