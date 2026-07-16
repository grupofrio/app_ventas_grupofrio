/**
 * Programa de Lealtad — lectura desde Odoo (wiring del fetch).
 *
 * Backend (verificado): NO usa el módulo nativo `loyalty.program/card/reward`.
 * El esquema es custom (`gf_partner_loyalty` + cron `gf_w14_loyalty_engine`) y
 * vive como campos de `res.partner` (ver loyaltyLogic.ts). NO hay endpoint
 * dedicado ni modelo de redención → MVP de SOLO LECTURA.
 *
 * Se lee mediante el endpoint scoped del empleado. El servidor valida que el
 * partner pertenece al alcance de la sesión antes de exponer sus datos.
 */

import { getEmployeeScopedLoyalty } from './employeeData';
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
 * Lee la lealtad de un cliente desde el endpoint scoped del empleado.
 * Devuelve null si no se encuentra el partner. Lanza si red/autorización falla
 * (el caller muestra error/offline). Solo lectura.
 */
export async function fetchPartnerLoyalty(partnerId: number): Promise<PartnerLoyalty | null> {
  if (!partnerId || partnerId <= 0) return null;
  return parsePartnerLoyalty(await getEmployeeScopedLoyalty(partnerId));
}
