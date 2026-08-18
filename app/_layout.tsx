/**
 * Root layout — providers, fonts, auth guard.
 */

import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, TextInput } from 'react-native';
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
import { colors } from '../src/theme/tokens';
import { GlobalRefreshButton } from '../src/components/ui/GlobalRefreshButton';
import { GlobalHomeButton } from '../src/components/ui/GlobalHomeButton';
// Importamos con cuidado estos servicios
import { rehydrateAppState } from '../src/services/rehydrate';
import { startConnectivityMonitor, checkConnectivity } from '../src/services/connectivity';
import { initializeGPS, startLocationWatch } from '../src/services/gps';
import { startBackgroundTracking } from '../src/services/gpsBackground';
import { requestInvoiceCollectionSync } from '../src/services/invoiceCollectionSync';
import { runNonblockingAppInitialization } from '../src/services/appInitialization';

// F2.7: tope global de escala de fuente por accesibilidad del sistema. Sin
// esto, un vendedor con "texto grande" activado en el teléfono puede romper
// layouts de una sola línea (KPIs, chips, barras fijas) que no tienen espacio
// para crecer sin límite. 1.4x sigue siendo una mejora real de legibilidad
// sobre el 1.0x por defecto, sin desbordar los layouts más ajustados.
// @ts-expect-error — defaultProps no está en los tipos de RN 0.76 pero sigue
// siendo el mecanismo soportado para un tope global (React 18, no 19).
Text.defaultProps = Text.defaultProps || {};
// @ts-expect-error — idem.
Text.defaultProps.maxFontSizeMultiplier = 1.4;
// @ts-expect-error — idem.
TextInput.defaultProps = TextInput.defaultProps || {};
// @ts-expect-error — idem.
TextInput.defaultProps.maxFontSizeMultiplier = 1.4;

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
    void runNonblockingAppInitialization({
      startConnectivityMonitor,
      checkConnectivity,
      onConfirmedOnline: requestInvoiceCollectionSync,
      onConnectivityError: (error) => console.log('Connectivity check failed', error),
      onInitializationError: (error) => console.error('[Init] Critical error during init:', error),
      onReady: () => {
        console.log('[Init] App ready set to true');
        setIsReady(true);
      },
      initializeAppState: async () => {
        console.log('[Init] Starting app initialization...');
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
            // Rehydrate the employee-scoped local state before starting GPS.
            console.log('[Init] Rehydrating app state...');
            await rehydrateAppState().catch(e => console.error('Rehydrate failed', e));
            // Dedicated collection replay is deliberately off the critical
            // rehydration path. Its processor checks the confirmed online bit;
            // the connectivity monitor later wakes this same singleton.
            requestInvoiceCollectionSync();

            // GPS initialization
            console.log('[Init] Initializing GPS...');
            void initializeGPS()
              .then(() => {
                startLocationWatch();
                return startBackgroundTracking();
              })
              .catch(e => console.log('[gps] GPS startup not available', e));
          }
        }
      },
    });
  }, []);

  // Auth guard
  useEffect(() => {
    if (!isReady || !fontsLoaded) {
        console.log('[Guard] Waiting for ready/fonts...', { isReady, fontsLoaded });
        return;
    }

    const inAuthGroup = segments[0] === '(auth)';
    console.log('[Guard] Current segments:', segments, 'IsAuthenticated:', isAuthenticated);

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
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" backgroundColor={colors?.bg || '#F0F9FF'} />
      <Slot />
      <GlobalRefreshButton />
      <GlobalHomeButton />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
