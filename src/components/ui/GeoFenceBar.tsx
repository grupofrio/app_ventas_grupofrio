/**
 * GeoFenceBar — banda de estado de geo-cerca. Presentacional: recibe el tono y
 * la etiqueta ya resueltos por `describeGeoStatus` (trustSignals), para no
 * inventar distancias (p.ej. "999m") cuando no hay GPS o geo del cliente.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme/tokens';
import type { GeoTone } from '../../services/trustSignals';

interface GeoFenceBarProps {
  tone: GeoTone;
  label: string;
}

export function GeoFenceBar({ tone, label }: GeoFenceBarProps) {
  const palette = TONE_PALETTE[tone] ?? TONE_PALETTE.unknown;
  return (
    <View style={[styles.bar, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.text, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const TONE_PALETTE: Record<GeoTone, { bg: string; border: string; fg: string }> = {
  ok: { bg: colors.successAlpha08, border: 'rgba(34,197,94,0.15)', fg: colors.success },
  far: { bg: colors.errorAlpha08, border: 'rgba(239,68,68,0.2)', fg: colors.error },
  low_accuracy: { bg: colors.warningAlpha08, border: 'rgba(245,158,11,0.2)', fg: colors.warning },
  unknown: { bg: colors.warningAlpha08, border: 'rgba(245,158,11,0.2)', fg: colors.warning },
};

const styles = StyleSheet.create({
  bar: {
    padding: 10,
    borderRadius: radii.button,
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
