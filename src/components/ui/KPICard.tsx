/**
 * KPI Card matching mockup .kp class — inside 2x2 grid.
 */

import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, radii } from '../../theme/tokens';
import { typography } from '../../theme/typography';

interface KPICardProps {
  label: string;
  value: string;
  subtitle?: string;
  valueColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function KPICard({ label, value, subtitle, valueColor, style }: KPICardProps) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[typography.kpiValue, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: 12,
  },
  label: {
    fontSize: 10,
    color: colors.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 10,
    color: colors.textDim,
    marginTop: 2,
  },
});
