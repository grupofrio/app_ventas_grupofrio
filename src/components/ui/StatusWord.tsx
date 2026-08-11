/**
 * StatusWord — palabra + glifo, nunca solo color (regla transversal del
 * plan F2: ningún estado se comunica solo por color, por accesibilidad y
 * por daltonismo). Lee de tokens.state; `label` opcional sobreescribe la
 * palabra por defecto del token (p.ej. "✓ Visitada" en vez de "✓ Listo").
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { state, radii } from '../../theme/tokens';
import { typography } from '../../theme/typography';

type StatusKey = keyof typeof state;

interface StatusWordProps {
  status: StatusKey;
  label?: string;
  compact?: boolean;
  style?: ViewStyle;
}

export function StatusWord({ status, label, compact = false, style }: StatusWordProps) {
  const token = state[status];
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: token.bg, borderColor: token.border },
        compact && styles.pillCompact,
        style,
      ]}
    >
      <Text style={[typography.badge, { color: token.fg }]}>
        {token.glifo} {label ?? token.palabra}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.badge,
    borderWidth: 1,
  },
  pillCompact: { paddingHorizontal: 6, paddingVertical: 2 },
});
