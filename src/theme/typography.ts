/**
 * Typography system from mockup CSS.
 * Body: DM Sans (300, 500, 700)
 * Data/numbers: Space Mono (400, 700)
 */

import { TextStyle } from 'react-native';
import { colors } from './tokens';

// Font families — loaded via @expo-google-fonts in _layout.tsx
// Names must match the exported font constant names
export const fonts = {
  body: 'DMSans_300Light',
  bodyMedium: 'DMSans_500Medium',
  bodyBold: 'DMSans_700Bold',
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
} as const;

// Typography presets matching mockup exactly
export const typography = {
  // Titles
  screenTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  } as TextStyle,

  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: colors.textDim,
  } as TextStyle,

  // Body text
  body: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  } as TextStyle,

  bodySmall: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
  } as TextStyle,

  dim: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: '400',
    color: colors.textDim,
  } as TextStyle,

  dimSmall: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '400',
    color: colors.textDim,
  } as TextStyle,

  // Numeric data (Space Mono)
  kpiValue: {
    fontFamily: fonts.monoBold,
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  } as TextStyle,

  kpiValueLarge: {
    fontFamily: fonts.monoBold,
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  } as TextStyle,

  scoreValue: {
    fontFamily: fonts.monoBold,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  } as TextStyle,

  scoreValueSmall: {
    fontFamily: fonts.monoBold,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  } as TextStyle,

  // Badge
  badge: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  } as TextStyle,

  // Buttons
  button: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textOnPrimary,
  } as TextStyle,

  buttonSmall: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textOnPrimary,
  } as TextStyle,

  // Labels
  inputLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colors.textDim,
  } as TextStyle,

  // Metric rows
  metricLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textDim,
  } as TextStyle,

  metricValue: {
    fontFamily: fonts.monoBold,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  } as TextStyle,

  // F2.3: glifo grande de estado (EmptyState/ErrorState) — mismo tamaño en
  // ambos para que se lean como el mismo tipo de bloque visual.
  stateIcon: {
    fontSize: 30,
  } as TextStyle,

  // F2.3: glifo +/- del Stepper compartido.
  stepperGlyph: {
    fontFamily: fonts.bodyBold,
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  } as TextStyle,

  // F2.4: encabezado de sección dentro de una Card (p.ej. "2 · Checklist de
  // unidad") — distinto de sectionTitle (que es uppercase/tracking ancho
  // para separadores de página).
  cardHeading: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  } as TextStyle,

  // F2.4: valor destacado dentro de una Card, texto (no numérico → no
  // monoespaciado). Distinto de kpiValue/scoreValue, que son Space Mono.
  cardValue: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  } as TextStyle,
} as const;
