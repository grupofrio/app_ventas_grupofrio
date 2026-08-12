import { Alert, Linking, Platform } from 'react-native';
import { buildStopNavigationUrls, type LocationLike } from './locationNavigation';

/**
 * F2.6: abre navegación externa para una parada — punto único usado por
 * route.tsx/RouteStopPanel, checkin, stop y offroute (antes cada pantalla
 * repetía su propia cadena Linking.openURL + catch + Alert).
 *
 * Con coordenadas, intenta primero el intent nativo de turn-by-turn
 * (Android `google.navigation:` / iOS `maps://app?daddr=`) — esto es lo que
 * antes SOLO tenía app/map.tsx (eliminado en F2.6): abre Maps directo en modo
 * navegación en vez de la pantalla de vista previa del lugar. Si el intent
 * nativo falla (o no hay coords), cae al link web de buildStopNavigationUrls.
 *
 * Vive separado de locationNavigation.ts (que se mantiene sin imports de
 * react-native) porque tests/locationNavigation.test.ts importa ese módulo
 * directo en Node puro para testear buildStopNavigationUrls — un import de
 * 'react-native' ahí rompe esa carga (RN usa sintaxis Flow que Node no
 * entiende fuera del entorno de Metro/Jest).
 */
export async function openStopNavigation(stop: LocationLike): Promise<void> {
  const { primaryUrl, fallbackUrl } = buildStopNavigationUrls(stop);
  const lat = stop.customer_latitude;
  const lon = stop.customer_longitude;
  const hasCoords = lat != null && lon != null;

  const openWebUrl = async () => {
    if (!primaryUrl) {
      Alert.alert('Sin ubicación', 'Este cliente no tiene ubicación disponible.');
      return;
    }
    try {
      await Linking.openURL(primaryUrl);
    } catch {
      if (fallbackUrl) {
        try {
          await Linking.openURL(fallbackUrl);
          return;
        } catch {
          // sigue al Alert de abajo
        }
      }
      Alert.alert('Error', 'No se pudo abrir la ubicación.');
    }
  };

  if (hasCoords) {
    const nativeUrl = Platform.select({
      ios: `maps://app?daddr=${lat},${lon}`,
      android: `google.navigation:q=${lat},${lon}`,
    });
    if (nativeUrl) {
      try {
        await Linking.openURL(nativeUrl);
        return;
      } catch {
        await openWebUrl();
        return;
      }
    }
  }

  await openWebUrl();
}
