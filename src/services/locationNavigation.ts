import {
  formatCustomerAddress,
  type CustomerAddressFields,
} from './formatCustomerAddress.ts';

/**
 * Construye las URLs de navegación externa (Google Maps) para una parada.
 * Prioridad: `google_maps_url` → coordenadas → dirección textual → null.
 *
 * PR dirección + nav: se añadió el fallback por dirección textual cuando NO hay
 * geo (antes devolvía null/null y el operador quedaba sin forma de navegar a un
 * cliente que sí tiene dirección). Sigue sin geocodificar: pasa la dirección
 * como `destination=<texto>` y deja que Google Maps la resuelva.
 */
export interface LocationLike extends CustomerAddressFields {
  customer_name: string;
  google_maps_url?: string;
  customer_latitude?: number;
  customer_longitude?: number;
}

export function buildStopNavigationUrls(stop: LocationLike): {
  primaryUrl: string | null;
  fallbackUrl: string | null;
} {
  const lat = stop.customer_latitude;
  const lon = stop.customer_longitude;
  const hasCoords = lat != null && lon != null;

  // P3 (Codex): destino por lat/lon SIN destination_place_id — antes se pasaba
  // el customer_name como place_id, que NO es un Place ID real y podía resolver
  // mal en Google Maps.
  const coordsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
    : null;

  // Fallback por dirección textual REAL (formatCustomerAddress ya excluye
  // referencia/landmark: hasAddress solo es true con dirección postal).
  const formatted = formatCustomerAddress(stop, stop);
  const addressUrl = formatted.hasAddress
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(formatted.text)}`
    : null;

  if (stop.google_maps_url) {
    // Mejor secundaria: coordenadas primero, luego dirección real.
    return { primaryUrl: stop.google_maps_url, fallbackUrl: coordsUrl ?? addressUrl };
  }

  if (hasCoords) {
    return { primaryUrl: coordsUrl, fallbackUrl: null };
  }

  // Sin geo pero con dirección REAL: navegar por texto.
  if (addressUrl) {
    return { primaryUrl: addressUrl, fallbackUrl: null };
  }

  // Ni geo ni dirección real: null controlado (las pantallas muestran Alert).
  return { primaryUrl: null, fallbackUrl: null };
}
