/**
 * Login screen — barcode + pin authentication.
 * Matches mockup s-login: dark bg, orange accent, centered form.
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { DEFAULT_BASE_URL } from '../../src/services/api';
import { Button } from '../../src/components/ui/Button';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography } from '../../src/theme/typography';

export default function LoginScreen() {
  const [barcode, setBarcode] = useState('');
  const [pin, setPin] = useState('');
  const { login, isLoading, error } = useAuthStore();

  async function handleLogin() {
    if (!barcode.trim() || !pin.trim()) {
      Alert.alert('Error', 'Ingresa codigo y PIN');
      return;
    }
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
          {/* Logo area */}
          <View style={styles.logoArea}>
            <Text style={styles.logoText}>KOLD</Text>
            <Text style={styles.logoSub}>Field</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>CODIGO DE EMPLEADO</Text>
              <TextInput
                style={styles.input}
                value={barcode}
                onChangeText={setBarcode}
                placeholder="Ej: 1234"
                placeholderTextColor={colors.textDim}
                keyboardType="number-pad"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>PIN</Text>
              <TextInput
                style={styles.input}
                value={pin}
                onChangeText={setPin}
                placeholder="****"
                placeholderTextColor={colors.textDim}
                secureTextEntry
                keyboardType="number-pad"
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Button
              label="Iniciar Sesion"
              onPress={handleLogin}
              loading={isLoading}
              fullWidth
            />
          </View>

          <Text style={styles.version}>KOLD Field v1.0 · Grupo Frio</Text>
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
    marginBottom: 40,
  },
  logoText: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 4,
  },
  logoSub: {
    fontSize: 18,
    fontWeight: '300',
    color: colors.textDim,
    letterSpacing: 8,
    marginTop: -4,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 5,
  },
  label: {
    ...typography.inputLabel,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
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
    fontSize: 12,
    textAlign: 'center',
  },
  version: {
    textAlign: 'center',
    color: colors.textDim,
    fontSize: 11,
    marginTop: 40,
  },
});
