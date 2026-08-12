/**
 * GrupoFrioLogo — isotipo + wordmark de Grupo Frío (F2.5).
 * Paths tomados 1:1 de assets/grupofrio-logo.svg (viewBox 0 0 274 194).
 * react-native-svg no soporta cargar el .svg de archivo directamente sin
 * el transformer de metro (no configurado) — se declaran los paths acá.
 *
 * El wordmark usa presets de typography.ts (no fontSize suelto — pasa el
 * guard de F2.2); el tamaño del isotipo escala vía transform, no
 * recalculando fontSize, para no necesitar valores ad-hoc.
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { typography } from '../../theme/typography';

// Azul institucional del isotipo fuente (assets/grupofrio-logo.svg) — no es
// colors.primary del tema app (ese es #0077BB); este es el azul de marca
// impreso en el logo real, se mantiene fijo independiente del tema.
const LOGO_BLUE = '#003c8f';

// Tamaño de referencia del isotipo para el que el wordmark (typography.dimSmall
// + cardHeading) queda proporcionado; otros tamaños escalan vía transform.
const BASE_ICON_SIZE = 48;

interface GrupoFrioLogoProps {
  /** Alto del isotipo en px; el wordmark solo se muestra si showWordmark. */
  size?: number;
  showWordmark?: boolean;
  style?: ViewStyle;
}

// Paths del cubo isométrico, viewBox local 0 0 90 104 (grupo interno del SVG fuente).
const CUBE_PATHS: { d: string; fill?: string; stroke?: string; strokeWidth?: number }[] = [
  { d: 'M45 0 0 26v52l45 26 45-26V26Z', fill: '#d8dce1' },
  { d: 'M45 0v33L17 49V17Z', fill: '#cfd3d8' },
  { d: 'M45 0 73 17v32L45 33Z', fill: '#bfc4ca' },
  { d: 'M17 49 45 33l28 16-28 17Z', fill: '#edf0f2' },
  { d: 'M0 78V26l17 10v52Z', fill: '#eef1f4' },
  { d: 'M90 26v52L73 88V36Z', fill: '#aeb4bd' },
  { d: 'M0 78 45 104V66L17 50 17 88Z', fill: '#0b4aa0' },
  { d: 'M90 78 45 104V66l28-16v38Z', fill: '#003c8f' },
  { d: 'M45 66 17 50l28-17 28 17Z', fill: '#f7f9fa' },
  { d: 'M45 0v33', stroke: '#fff', strokeWidth: 3 },
  { d: 'M17 17v33l28 16v38', stroke: '#fff', strokeWidth: 3 },
  { d: 'M73 17v33L45 66', stroke: '#fff', strokeWidth: 3 },
];

export function GrupoFrioIcon({ size = BASE_ICON_SIZE }: { size?: number }) {
  return (
    <Svg width={size} height={size * (104 / 90)} viewBox="0 0 90 104">
      {CUBE_PATHS.map((p, i) => (
        <Path
          key={i}
          d={p.d}
          fill={p.fill ?? 'none'}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
        />
      ))}
    </Svg>
  );
}

export function GrupoFrioLogo({ size = BASE_ICON_SIZE, showWordmark = true, style }: GrupoFrioLogoProps) {
  if (!showWordmark) {
    return <GrupoFrioIcon size={size} />;
  }
  const scale = size / BASE_ICON_SIZE;
  return (
    <View style={[styles.row, { transform: [{ scale }] }, style]}>
      <GrupoFrioIcon size={BASE_ICON_SIZE} />
      <View>
        <Text style={[typography.dimSmall, styles.grupo]}>GRUPO</Text>
        <Text style={[typography.cardHeading, styles.frio]}>FRIO</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grupo: { color: LOGO_BLUE, letterSpacing: 1.5 },
  frio: { color: LOGO_BLUE, letterSpacing: 2 },
});
