/**
 * Pure helper para resolver la navegación al siguiente cliente tras checkout.
 * No RN, no store — unit-testable.
 *
 * - `origin` = posición actual del vendedor (de useLocationStore). Si no hay
 *   fix válido, queda en `null` (la navegación arranca sin origen) — NUNCA se
 *   inyecta `0,0` como coordenada falsa.
 * - `destination` = coordenadas del siguiente cliente. Si el siguiente cliente
 *   no tiene coordenadas, se devuelve `null` (no se inicia navegación).
 */

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface CheckoutNavigation {
  origin: LatLon | null;
  destination: LatLon;
}

interface NextStopCoords {
  customer_latitude?: number | null;
  customer_longitude?: number | null;
}

function validCoord(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n !== 0;
}

export function buildCheckoutNavigation(
  userLat: number | null | undefined,
  userLon: number | null | undefined,
  next: NextStopCoords | null | undefined,
): CheckoutNavigation | null {
  if (!next || !validCoord(next.customer_latitude) || !validCoord(next.customer_longitude)) {
    return null;
  }
  const origin: LatLon | null = validCoord(userLat) && validCoord(userLon)
    ? { latitude: userLat, longitude: userLon }
    : null;
  return {
    origin,
    destination: { latitude: next.customer_latitude, longitude: next.customer_longitude },
  };
}
