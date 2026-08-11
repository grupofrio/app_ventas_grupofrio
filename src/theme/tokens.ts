/**
 * Design tokens — tema claro institucional (F2.1).
 *
 * Espejo de colaboradores-pwa/src/theme/brandTokens.js y del mockup
 * mockups_koldfield_2.html (artefacto "koldfield-mockups-vendedor"). Cada
 * color/radio/sombra viene de ahí — no se inventan valores fuera de esa
 * paleta sancionada. Reemplaza el tema oscuro anterior (kold_field_v2)
 * completo: la app pasa a tema claro único, mejor legibilidad bajo el sol
 * en campo.
 *
 * Los NOMBRES de las claves se conservan (bg, card, text, success…) para
 * no forzar un rename masivo en ~40 archivos que ya las consumen — F2.1
 * es un cambio de VALORES. Los canales `state`/`freshness`/`shadows`/
 * `gradients` son aditivos, nuevos en F2.1.
 */

export const colors = {
  // Brand — tema claro institucional (mockup --blue/--blue2/--blue3)
  primary: '#0077BB',       // --blue
  primaryDark: '#005A8D',   // --blue3, pressed state / CTA gradient end
  primaryAlpha12: 'rgba(0,119,187,0.12)',
  primaryAlpha08: 'rgba(0,119,187,0.08)',
  primaryAlpha04: 'rgba(0,119,187,0.04)',

  // Backgrounds
  bg: '#F0F9FF',             // --bg0
  card: '#FFFFFF',           // --surface
  cardLighter: '#F7FCFF',    // --surface-soft (inputs, superficies secundarias)
  surface: '#E0F3FC',        // --surface-strong / --bg2

  // Text
  text: '#0F2A3D',           // --text
  textDim: '#5B7285',        // --text-muted / --text-low
  textOnPrimary: '#FFFFFF',

  // Semantic — semáforos AA con palabra + glifo (ver `state` abajo)
  success: '#166534',        // --success
  successAlpha12: 'rgba(22,101,52,0.12)',
  successAlpha08: 'rgba(22,101,52,0.08)',

  error: '#b91c1c',          // --error
  errorAlpha12: 'rgba(185,28,28,0.12)',
  errorAlpha08: 'rgba(185,28,28,0.08)',

  warning: '#b45309',        // --warning
  warningAlpha12: 'rgba(180,83,9,0.12)',
  warningAlpha08: 'rgba(180,83,9,0.08)',

  // El mockup no define un "info" separado de los azules institucionales —
  // se reutiliza --blue2 (acento cian-azul) en vez de inventar un hue nuevo.
  info: '#00B8D4',           // --blue2
  infoAlpha12: 'rgba(0,184,212,0.12)',
  infoAlpha08: 'rgba(0,184,212,0.08)',

  cyan: '#00B8D4',           // --blue2 (mismo acento; Diamante/Lealtad)
  cyanAlpha12: 'rgba(0,184,212,0.12)',

  // Tampoco hay "purple" en el mockup (Probabilidad KOLD). Se reutiliza el
  // azul más oscuro de la familia en vez de introducir un hue ajeno a la
  // paleta sancionada.
  purple: '#005A8D',         // --blue3
  purpleAlpha12: 'rgba(0,90,141,0.12)',

  // Borders
  border: '#DBEFF9',         // --border
  borderLight: 'rgba(0,119,187,0.18)', // --border-blue (outline de CTA ghost)
} as const;

export const spacing = {
  screenPadding: 20,
  cardPadding: 14,
  cardPaddingLg: 16,
  cardGap: 10,
  sectionGapTop: 16,
  sectionGapBottom: 8,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 14,
  xxl: 20,
} as const;

// F2.1: radios objetivo del plan — 14 / 18 / 22 / 24 / pill. Se conservan
// los nombres de clave existentes (card/button/badge/circle/sm/xs) y se
// reasignan a esta escala; `lg` es nuevo (hero/panel/bottom sheet).
export const radii = {
  xs: 14,
  sm: 18,
  button: 18,     // botones secundarios/iconbtn (mockup .iconbtn: 18px)
  badge: 999,     // chips: un solo radio, pill (F2.3)
  card: 22,       // tarjetas (mockup .card: 22px)
  lg: 24,         // hero/panel/bottom sheet (mockup .hero/.panel: 24px)
  circle: 999,    // avatar/FAB circular
} as const;

export const sizes = {
  statusBarHeight: 44,
  topBarHeight: 44,
  bottomNavHeight: 58,
  buttonMinHeight: 50,      // mockup .cta: min-height 50px
  buttonSmMinHeight: 46,    // F1.4: objetivo táctil ≥44px, alineado a steppers
  scoreRing: 50,
  scoreRingInner: 38,
  backButton: 38,           // mockup .iconbtn: 38px
  iconSize: 18,
} as const;

// F2.1: sombras suaves del mockup (--sh-soft/--sh-md/--sh-lg), traducidas a
// props nativas de RN (shadow* para iOS, elevation para Android). No existe
// box-shadow en RN — este es el equivalente correcto, no un string CSS.
export const shadows = {
  soft: {
    shadowColor: '#0F2A3D', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 2, elevation: 1,
  },
  md: {
    shadowColor: '#0F2A3D', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  lg: {
    shadowColor: '#0F2A3D', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10, shadowRadius: 24, elevation: 6,
  },
} as const;

// F2.1: stops de gradiente del mockup (--cta, --hero). RN no interpola
// `linear-gradient(...)` en backgroundColor — se consumen con
// expo-linear-gradient (<LinearGradient colors={gradients.cta.colors}
// start={gradients.cta.start} end={gradients.cta.end} />), no como string.
export const gradients = {
  // CTA pill, 90deg izquierda→derecha: --cta: linear-gradient(90deg,#005A8D,#0077BB)
  cta: { colors: ['#005A8D', '#0077BB'] as [string, string], start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  // Hero, 135deg: --hero: linear-gradient(135deg,#005A8D 0%,#00B8D4 100%)
  hero: { colors: ['#005A8D', '#00B8D4'] as [string, string], start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
} as const;

// F2.1: canal `state` — cada estado trae fg/bg/border/glifo/palabra juntos,
// para que ninguna pantalla nueva pase revisión con "color sin palabra"
// (regla transversal del plan). Úsese con StatusWord (F2.3).
export interface StateToken {
  fg: string;
  bg: string;
  border: string;
  glifo: string;
  palabra: string;
}

export const state: Record<'ok' | 'warn' | 'error' | 'pending' | 'queued' | 'info', StateToken> = {
  ok: { fg: colors.success, bg: colors.successAlpha12, border: 'rgba(22,101,52,0.28)', glifo: '✓', palabra: 'Listo' },
  warn: { fg: colors.warning, bg: colors.warningAlpha12, border: 'rgba(180,83,9,0.28)', glifo: '⚠', palabra: 'Por revisar' },
  error: { fg: colors.error, bg: colors.errorAlpha12, border: 'rgba(185,28,28,0.28)', glifo: '✕', palabra: 'Rechazado' },
  pending: { fg: colors.textDim, bg: colors.cardLighter, border: colors.border, glifo: '▢', palabra: 'Pendiente' },
  queued: { fg: colors.warning, bg: colors.warningAlpha12, border: 'rgba(180,83,9,0.28)', glifo: '🕑', palabra: 'En cola' },
  info: { fg: colors.primaryDark, bg: colors.surface, border: colors.borderLight, glifo: '◈', palabra: 'Info' },
};

// F2.1: canal `freshness` — separado de `state`: describe antigüedad de
// datos (plan/catálogo preparado), no resultado de una acción. Mismo
// vocabulario que getRouteFreshnessBadge ya usa en route.tsx.
export interface FreshnessToken {
  fg: string;
  bg: string;
  label: string;
}

export const freshness: Record<'fresh' | 'cached' | 'stale', FreshnessToken> = {
  fresh: { fg: colors.success, bg: colors.successAlpha12, label: 'Actualizada' },
  cached: { fg: colors.textDim, bg: colors.cardLighter, label: 'Offline/cache' },
  stale: { fg: colors.warning, bg: colors.warningAlpha12, label: 'Pendiente de actualizar' },
};

// Badge variant colors
export const badgeVariants = {
  orange: { bg: colors.warningAlpha12, text: colors.warning },
  green: { bg: colors.successAlpha12, text: colors.success },
  red: { bg: colors.errorAlpha12, text: colors.error },
  yellow: { bg: colors.warningAlpha12, text: colors.warning },
  blue: { bg: colors.infoAlpha12, text: colors.primaryDark },
  cyan: { bg: colors.cyanAlpha12, text: colors.cyan },
  purple: { bg: colors.purpleAlpha12, text: colors.purple },
  dim: { bg: colors.cardLighter, text: colors.textDim },
} as const;

export type BadgeVariant = keyof typeof badgeVariants;

// Stop card border colors by state
export const stopStateColors: Record<string, string> = {
  pending: colors.textDim,
  in_progress: colors.primary,
  done: colors.success,
  not_visited: colors.textDim,
  no_stock: colors.warning,
  rejected: colors.error,
  closed: colors.textDim,
};
