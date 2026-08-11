/**
 * Stepper — control +/- de cantidad, 46px táctil (F1.4/F2.3).
 * Extrae el patrón ya usado en sale/[stopId].tsx y ProductPicker (qtyBtn)
 * a un componente compartido para que las pantallas de F2.4 no repitan
 * el mismo bloque de estilos.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { colors, radii, sizes } from '../../theme/tokens';
import { typography } from '../../theme/typography';

interface StepperProps {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Stepper({ value, onIncrement, onDecrement, min = 1, max = 999, disabled = false, style }: StepperProps) {
  const canDecrement = !disabled && value > min;
  const canIncrement = !disabled && value < max;

  return (
    <View style={[styles.row, style]}>
      <TouchableOpacity
        style={[styles.btn, !canDecrement && styles.btnDisabled]}
        onPress={onDecrement}
        disabled={!canDecrement}
        accessibilityRole="button"
        accessibilityLabel="Restar"
      >
        <Text style={typography.stepperGlyph}>−</Text>
      </TouchableOpacity>
      <Text style={[typography.scoreValue, styles.value]}>{value}</Text>
      <TouchableOpacity
        style={[styles.btn, !canIncrement && styles.btnDisabled]}
        onPress={onIncrement}
        disabled={!canIncrement}
        accessibilityRole="button"
        accessibilityLabel="Sumar"
      >
        <Text style={typography.stepperGlyph}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: {
    width: sizes.buttonSmMinHeight,
    height: sizes.buttonSmMinHeight,
    borderRadius: radii.button,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.35 },
  value: {
    minWidth: 40,
    textAlign: 'center',
  },
});
