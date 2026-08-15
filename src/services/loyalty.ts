/**
 * Programa de Lealtad — lectura acotada al cliente visible para el empleado.
 */

import { postRest } from './api';
import {
  parsePartnerLoyalty,
  type PartnerLoyalty,
} from './loyaltyLogic';

const EMPLOYEE_API_BASE = '/gf/logistics/api/employee';

export type { LoyaltyLevel, PartnerLoyalty, LoyaltyLevelInfo } from './loyaltyLogic';
export {
  parsePartnerLoyalty,
  hasLoyaltyData,
  describeLoyaltyLevel,
  PARTNER_LOYALTY_FIELDS,
} from './loyaltyLogic';

/**
 * Lee la lealtad allowlisted de un cliente visible para la sesión Bearer.
 */
export async function fetchPartnerLoyalty(partnerId: number): Promise<PartnerLoyalty | null> {
  if (!partnerId || partnerId <= 0) return null;
  const response = await postRest<{
    ok: true;
    message: string;
    data: { customer: Record<string, unknown> };
  }>(
    `${EMPLOYEE_API_BASE}/customer/loyalty`,
    { partner_id: partnerId },
  );
  const customer = response?.data?.customer;
  if (!response || response.ok !== true || !customer || typeof customer !== 'object') {
    throw new Error('La respuesta de lealtad no cumple el contrato de empleado.');
  }
  return parsePartnerLoyalty({
    id: customer.id,
    name: customer.name,
    x_loyalty_level: customer.x_loyalty_level,
    x_loyalty_streak: customer.x_loyalty_streak,
    x_last_order_week: customer.x_last_order_week,
  });
}
