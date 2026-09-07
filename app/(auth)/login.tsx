/**
 * Login screen — barcode + pin authentication.
 * Matches mockup s-login: dark bg, orange accent, centered form.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { DEFAULT_BASE_URL } from '../../src/services/api';
import { describeLoginOfflineNotice } from '../../src/services/authOffline';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { GrupoFrioLogo } from '../../src/components/ui/GrupoFrioLogo';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography } from '../../src/theme/typography';
import { getRuntimeAppEnvironment } from '../../src/config/appEnvironment.ts';
import { useStagingBackendStore } from '../../src/stores/useStagingBackendStore.ts';

export default function LoginScreen() {
  const [barcode, setBarcode] = useState('');
  const [pin, setPin] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [validationError, setValidationError] = useState('');
  const { login, isLoading, error } = useAuthStore();
  const identity = useStagingBackendStore((state) => state.identity);
  const environment = getRuntimeAppEnvironment(
    Constants.expoConfig?.extra?.appEnvironment as string | undefined,
  );

  // Conectividad para el aviso offline (login nuevo requiere internet; una
  // sesión previa se restaura sola al abrir la app vía rehydrateAuth).
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setIsOnline(!!(s.isConnected && s.isInternetReachable !== false));
    });
    return () => unsub();
  }, []);

  const offlineNotice = describeLoginOfflineNotice(isOnline);

  async function handleLogin() {
    if (!barcode.trim() || !pin.trim()) {
      setValidationError('Ingresa código y PIN');
      return;
    }
    setValidationError('');
    await login(DEFAULT_BASE_URL, barcode.trim(), pin.trim());
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo area — isotipo+wordmark real de Grupo Frío (F2.5) */}
          <View style={styles.logoArea}>
            <GrupoFrioLogo size={64} />
            <Text style={[typography.screenTitle, styles.appName]}>KOLD Field</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Input
              label="CÓDIGO DE EMPLEADO"
              value={barcode}
              onChangeText={setBarcode}
              placeholder="Ej: 1234"
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Input
              label="PIN"
              value={pin}
              onChangeText={setPin}
              placeholder="****"
              secureTextEntry
              keyboardType="number-pad"
              error={validationError || undefined}
            />

            {offlineNotice ? (
              <View style={styles.offlineBox}>
                <Text style={[typography.dim, styles.offlineText]}>📴 {offlineNotice}</Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <Text style={[typography.dim, styles.errorText]}>{error}</Text>
              </View>
            ) : null}

            {environment === 'staging' ? (
              <View style={identity.status === 'verified' ? styles.verifiedBox : styles.unverifiedBox}>
                <Text style={[typography.dim, styles.backendStatusText]}>
                  {identity.status === 'verified'
                    ? `STAGING verificado: ${identity.host} / ${identity.db}`
                    : identity.status === 'configured'
                      ? `STAGING · modo de pruebas: ${identity.host} / ${identity.db}. DB configurada, sin verificación automática.`
                      : Constants.expoConfig?.extra?.stagingUseConfiguredDb === true
                        ? 'STAGING · modo de pruebas con DB configurada. Ingresa tu código y PIN.'
                        : 'STAGING no verificado. Confirma host y DB antes de operar.'}
                </Text>
              </View>
            ) : null}

            <Button
              label="Iniciar Sesion"
              onPress={handleLogin}
              loading={isLoading}
              fullWidth
            />
          </View>

          <Text style={[typography.dimSmall, styles.version]}>KOLD Field v1.0 · Grupo Frio</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.screenPadding,
  },
  logoArea: {
    alignItems: 'center',
    gap: 14,
    marginBottom: 40,
  },
  appName: {
    color: colors.textDim,
  },
  form: {
    gap: 16,
  },
  offlineBox: {
    backgroundColor: colors.warningAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
    borderRadius: radii.button,
    padding: 10,
  },
  offlineText: {
    color: colors.warning,
    lineHeight: 16,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: colors.errorAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.15)',
    borderRadius: radii.button,
    padding: 10,
  },
  errorText: {
    color: colors.error,
    textAlign: 'center',
  },
  verifiedBox: {
    backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: radii.button, padding: 10,
  },
  unverifiedBox: {
    backgroundColor: colors.warningAlpha08, borderRadius: radii.button, padding: 10,
  },
  backendStatusText: { textAlign: 'center', lineHeight: 16 },
  version: {
    textAlign: 'center',
    marginTop: 40,
  },
});
