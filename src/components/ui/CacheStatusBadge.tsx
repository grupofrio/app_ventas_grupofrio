/**
 * CacheStatusBadge — Perf Fase 2C.
 *
 * Badge discreto que indica cuando la pantalla muestra datos de CACHÉ o el
 * dispositivo está SIN CONEXIÓN. Se alimenta de la metadata de 2B
 * (`useProductStore.fromCache/cachedAtMs`) + conectividad (`useSyncStore`),
 * vía el helper puro `describeCacheStatus`.
 *
 * Se oculta solo cuando hay conexión y los datos son frescos de red (sin ruido).
 * Es informativo: NO cambia reglas de venta. La venta sigue online-first.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme/tokens';
import { useProductStore } from '../../stores/useProductStore';
import { useSyncStore } from '../../stores/useSyncStore';
import { describeCacheStatus } from '../../services/cacheStatus';

interface Props {
  /** Si true, muestra la línea "Actualizado hace X" bajo la etiqueta. */
  showDetail?: boolean;
  style?: object;
}

const TONE_STYLE: Record<string, { bg: string; border: string; fg: string }> = {
  warn: { bg: 'rgba(234,179,8,0.10)', border: 'rgba(234,179,8,0.45)', fg: '#B45309' },
  info: { bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.35)', fg: colors.primary },
  ok: { bg: 'transparent', border: 'transparent', fg: colors.textDim },
};

export function CacheStatusBadge({ showDetail = false, style }: Props) {
  const fromCache = useProductStore((s) => s.fromCache);
  const cachedAtMs = useProductStore((s) => s.cachedAtMs);
  const isOnline = useSyncStore((s) => s.isOnline);

  const status = describeCacheStatus({ fromCache, cachedAtMs, isOnline, nowMs: Date.now() });
  if (!status.show) return null;

  const tone = TONE_STYLE[status.tone] ?? TONE_STYLE.info;

  return (
    <View
      style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }, style]}
      accessibilityRole="text"
      accessibilityLabel={`${status.label}${status.detail ? `. ${status.detail}` : ''}`}
    >
      <Text style={[styles.dot, { color: tone.fg }]}>●</Text>
      <Text style={[styles.label, { color: tone.fg }]} numberOfLines={1}>
        {status.label}
        {showDetail && status.detail ? ` · ${status.detail}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.button,
    borderWidth: 1,
  },
  dot: { fontSize: 8 },
  label: { fontSize: 11, fontWeight: '700' },
});
