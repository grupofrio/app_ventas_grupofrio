/**
 * Chip — selector tipo pill, un solo radio (radii.badge) para toda la app
 * (regla F2 transversal: "un solo radio de chip", no valores sueltos por
 * pantalla). Reemplaza los catTab/catBar/paymentRow ad-hoc de
 * ProductPicker/sale que hoy repiten el mismo patrón con radios distintos.
 */

import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, radii } from '../../theme/tokens';
import { typography, fonts } from '../../theme/typography';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Chip({ label, selected = false, onPress, icon, disabled = false, style }: ChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
      style={[
        styles.chip,
        selected && styles.chipSelected,
        disabled && styles.chipDisabled,
        style,
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected } : undefined}
    >
      {icon ? <Text style={typography.bodySmall}>{icon}</Text> : null}
      <Text style={[typography.bodySmall, styles.label, selected && styles.labelSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.badge,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.primaryAlpha12,
    borderColor: colors.primary,
  },
  chipDisabled: { opacity: 0.5 },
  label: { color: colors.textDim, fontWeight: '500' },
  labelSelected: { color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700' },
});
