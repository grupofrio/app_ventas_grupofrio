import React, { useCallback } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { colors, radii, sizes, spacing } from '../../theme/tokens';
import { useAuthStore } from '../../stores/useAuthStore';

export function GlobalHomeButton() {
  const router = useRouter();
  const segments = useSegments();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const inAuthGroup = segments[0] === '(auth)';
  const inTabsGroup = segments[0] === '(tabs)';

  const goHome = useCallback(() => {
    router.replace('/(tabs)' as never);
  }, [router]);

  if (!isAuthenticated || inAuthGroup) {
    return null;
  }

  return (
    <TouchableOpacity
      accessibilityLabel="Ir al inicio"
      accessibilityRole="button"
      activeOpacity={0.82}
      onPress={goHome}
      style={[styles.button, inTabsGroup && styles.buttonAboveTabs]}
    >
      <Ionicons name="home" size={22} color={colors.textOnPrimary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: spacing.screenPadding,
    bottom: spacing.xxl,
    width: 50,
    height: 50,
    borderRadius: radii.circle,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  buttonAboveTabs: {
    bottom: sizes.bottomNavHeight + spacing.xl,
  },
});
