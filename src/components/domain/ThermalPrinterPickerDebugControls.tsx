import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';

import { buildLongSaleThermalTicketFixture } from '../../services/thermalTicketFixtures.ts';
import { colors, radii, spacing } from '../../theme/tokens';
import { typography } from '../../theme/typography';
import type { ThermalPrinterPickerDebugControlsProps } from './ThermalPrinterPicker.tsx';

export function ThermalPrinterPickerDebugControls({
  disabled,
  loading,
  onRun,
  onPrintTicket,
}: ThermalPrinterPickerDebugControlsProps) {
  const handleLongTicket = useCallback(() => {
    onRun(() => onPrintTicket(buildLongSaleThermalTicketFixture()));
  }, [onPrintTicket, onRun]);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Imprimir ticket largo de prueba"
      accessibilityState={{ disabled }}
      activeOpacity={0.8}
      disabled={disabled}
      onPress={handleLongTicket}
      style={[styles.debugAction, disabled && styles.disabled]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <Text style={styles.debugActionText}>
          Imprimir ticket largo de prueba
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  debugAction: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.screenPadding,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.cardLighter,
    borderRadius: radii.button,
  },
  debugActionText: {
    ...typography.button,
    color: colors.text,
  },
  disabled: {
    opacity: 0.5,
  },
});
