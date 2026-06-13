/**
 * Root layout — providers, fonts, auth guard.
 */

import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts as useDMSans,
  DMSans_300Light,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  useFonts as useSpaceMono,
  SpaceMono_400Regular,
  SpaceMono_700Bold,
} from '@expo-google-fonts/space-mono';
import { useAuthStore } from '../src/stores/useAuthStore';
import { hasAuthTokens } from '../src/services/api';
import { setServiceCredentials } from '../src/services/odooSession';
import { colors } from '../src/theme/tokens';
import { GlobalRefreshButton } from '../src/components/ui/GlobalRefreshButton';
import { GlobalHomeButton } from '../src/components/ui/GlobalHomeButton';
// Importamos con cuidado estos servicios
import { rehydrateAppState } from '../src/services/rehydrate';
import { startConnectivityMonitor, checkConnectivity } from '../src/services/connectivity';
import { initializeGPS, startLocationWatch } from '../src/services/gps';
import { startBackgroundTracking } from '../src/services/gpsBackground';

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const segments = useSegments();
  const router = useRouter();

  // Load fonts
  const [dmLoaded, dmError] = useDMSans({
    DMSans_300Light,
    DMSans_500Medium,
    DMSans_700Bold,
  });
  const [monoLoaded, monoError] = useSpaceMono({
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  const fontsLoaded = dmLoaded && monoLoaded;

  useEffect(() => {
    async function initApp() {
      console.log('[Init] Starting app initialization...');
      try {
        // 1. Check auth tokens + restore employee data
        const hasTokens = await hasAuthTokens();
        console.log('[Init] Auth tokens found:', hasTokens);
        if (hasTokens) {
          // BLD-20260408-P0: Restore full employee state (employeeId, warehouseId, etc.)
          // from AsyncStorage. If essential fields are missing, force re-login.
          const authValid = await useAuthStore.getState().rehydrateAuth();
          if (!authValid) {
            console.warn('[Init] Auth tokens exist but employee data missing — forcing login');
            // Clear stale tokens so user gets login screen
            const { clearAuthTokens: clearTokens } = await import('../src/services/api');
            await clearTokens();
            // Don't set isAuthenticated — user will see login screen
          } else {
            // 1.5. Initialize Odoo session credentials for pricelist access
            // These are used by odooRpc → sessionRpc to authenticate with
            // /web/dataset/call_kw, which requires a web session (not Api-Key).
            setServiceCredentials('direccion@grupofrio.mx', 'AbundanciaGrupoFrio2025.');

            // 2. Perf Fase 1C: analytics del empleado + rehidratación (cola,
            // ruta, productos) son independientes → en paralelo para acortar el
            // arranque en redes lentas.
            console.log('[Init] Rehydrating app state...');
            await Promise.all([
              useAuthStore.getState().ensureEmployeeAnalytics().catch(e => console.error('Analytics failed', e)),
              rehydrateAppState().catch(e => console.error('Rehydrate failed', e)),
            ]);

            // 3. GPS Initialization
            console.log('[Init] Initializing GPS...');
            void initializeGPS()
              .then(() => {
                startLocationWatch();
                return startBackgroundTracking();
              })
              .catch(e => console.log('[gps] GPS startup not available', e));
          }
        }

        // 4. Connectivity monitor
        console.log('[Init] Starting connectivity monitor...');
        startConnectivityMonitor();
        await checkConnectivity().catch(e => console.log('Connectivity check failed'));

      } catch (error) {
        console.error('[Init] Critical error during init:', error);
      } finally {
        console.log('[Init] App ready set to true');
        setIsReady(true);
      }
    }
    initApp();
  }, []);

  // Auth guard
  useEffect(() => {
    if (!isReady || !fontsLoaded) {
        console.log('[Guard] Waiting for ready/fonts...', { isReady, fontsLoaded });
        return;
    }

    const inAuthGroup = segments[0] === '(auth)';
    console.log('[Guard] Current segments:', segments, 'IsAuthenticated:', isAuthenticated);

    // Ensure Odoo session credentials are configured whenever user is authenticated
    // (covers both fresh login and app restart)
    if (isAuthenticated) {
      setServiceCredentials('direccion@grupofrio.mx', 'AbundanciaGrupoFrio2025.');
      void useAuthStore.getState().ensureEmployeeAnalytics();
    }

    if (!isAuthenticated && !inAuthGroup) {
      console.log('[Guard] Redirecting to login');
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      console.log('[Guard] Redirecting to tabs');
      router.replace('/(tabs)');
    }
  }, [isReady, fontsLoaded, isAuthenticated, segments]);

  if (!isReady || !fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors?.primary || '#000'} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" backgroundColor={colors?.bg || '#000'} />
      <Slot />
      <GlobalRefreshButton />
      <GlobalHomeButton />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#0F1419',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
