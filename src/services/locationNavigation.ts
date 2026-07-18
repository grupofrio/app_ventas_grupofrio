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

  const coordsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
    : null;

  // Fallback por dirección textual (solo si hay dirección real).
  const formatted = formatCustomerAddress(stop, stop);
  const addressUrl = formatted.hasAddress
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(formatted.text)}`
    : null;

  // Mejor URL secundaria disponible: coordenadas primero, luego dirección.
  const fallbackUrl = coordsUrl ?? addressUrl;

  if (stop.google_maps_url) {
    return { primaryUrl: stop.google_maps_url, fallbackUrl };
  }

  if (hasCoords) {
    const label = encodeURIComponent(stop.customer_name);
    return {
      primaryUrl: `${coordsUrl}&destination_place_id=${label}`,
      fallbackUrl: coordsUrl,
    };
  }

  // Sin geo pero con dirección: navegar por texto.
  if (addressUrl) {
    return { primaryUrl: addressUrl, fallbackUrl: null };
  }

  // Ni geo ni dirección: null controlado (las pantallas muestran Alert claro).
  return { primaryUrl: null, fallbackUrl: null };
}
