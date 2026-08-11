/**
 * ActionBar — barra fija de acción al pie de pantalla (F1.5/F2.3).
 * Extrae el patrón `fixedBar` ya usado en sale/[stopId].tsx a un
 * componente compartido para que el resto de F2.4 no lo repita.
 */

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme/tokens';

interface ActionBarProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export function ActionBar({ children, style }: ActionBarProps) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <View style={[styles.bar, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.bg },
  bar: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.bg,
  },
});
