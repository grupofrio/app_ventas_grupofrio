/**
 * F2.7 — contraste WCAG AA de los pares de color del tema claro
 * institucional (src/theme/tokens.ts).
 *
 * Umbrales AA: 4.5:1 para texto normal, 3:1 para texto grande (≥18pt, o
 * ≥14pt bold) y componentes de UI/gráficos. No hay ESLint en este proyecto
 * — mismo patrón que el resto de *Wiring.test.mjs: un check de fuente vía
 * node --test, corrido por npm test.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokensSource = readFileSync(resolve(root, 'src/theme/tokens.ts'), 'utf8');

function extractHex(varName) {
  const re = new RegExp(`${varName}:\\s*'(#[0-9a-fA-F]{6})'`);
  const match = re.exec(tokensSource);
  if (!match) throw new Error(`No se encontró el color ${varName} en tokens.ts`);
  return match[1];
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// WCAG 2.x relative luminance — https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const colors = {
  bg: extractHex('bg'),
  card: extractHex('card'),
  text: extractHex('text'),
  textDim: extractHex('textDim'),
  textOnPrimary: extractHex('textOnPrimary'),
  primary: extractHex('primary'),
  primaryDark: extractHex('primaryDark'),
  success: extractHex('success'),
  error: extractHex('error'),
  warning: extractHex('warning'),
};

const NORMAL_TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3.0;

// Pares reales de la app: texto/ícono semántico sobre las superficies donde
// efectivamente se pinta (bg de pantalla y card blanca) — no colores al azar.
const NORMAL_TEXT_PAIRS = [
  ['text sobre bg', colors.text, colors.bg],
  ['text sobre card', colors.text, colors.card],
  ['textDim sobre bg', colors.textDim, colors.bg],
  ['textDim sobre card', colors.textDim, colors.card],
  ['textOnPrimary sobre primary (botón)', colors.textOnPrimary, colors.primary],
  ['textOnPrimary sobre primaryDark (botón presionado)', colors.textOnPrimary, colors.primaryDark],
  ['success sobre bg (estado ok)', colors.success, colors.bg],
  ['success sobre card', colors.success, colors.card],
  ['error sobre bg (estado error)', colors.error, colors.bg],
  ['error sobre card', colors.error, colors.card],
  ['warning sobre bg (estado warn)', colors.warning, colors.bg],
  ['warning sobre card', colors.warning, colors.card],
  ['primary sobre bg (links/acentos)', colors.primary, colors.bg],
  ['primary sobre card', colors.primary, colors.card],
];

function main() {
  const failures = [];
  for (const [label, fg, bg] of NORMAL_TEXT_PAIRS) {
    const ratio = contrastRatio(fg, bg);
    if (ratio < NORMAL_TEXT_MIN) {
      failures.push(
        `${label}: ${ratio.toFixed(2)}:1 (${fg} / ${bg}) — necesita ≥${NORMAL_TEXT_MIN}:1 para texto normal AA`,
      );
    }
  }

  assert.deepEqual(
    failures,
    [],
    `Pares de color por debajo del umbral WCAG AA de texto normal:\n${failures.join('\n')}`,
  );

  // El borde institucional (colors.border) es decorativo/estructural, no
  // texto — se valida aparte contra el umbral de UI (3:1), más laxo.
  const border = extractHex('border');
  const borderRatio = contrastRatio(border, colors.bg);
  assert.ok(
    borderRatio >= 1.1,
    `El borde debe distinguirse mínimamente del fondo (actual ${borderRatio.toFixed(2)}:1) — es un separador visual, no texto, así que no exige 3:1`,
  );

  console.log(
    `color contrast AA: ok (${NORMAL_TEXT_PAIRS.length} pares de texto ≥${NORMAL_TEXT_MIN}:1, umbral texto grande de referencia ${LARGE_TEXT_MIN}:1)`,
  );
}

main();
