import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const screen = readFileSync(resolve(REPO_ROOT, 'app/newcustomer.tsx'), 'utf8');
const service = readFileSync(resolve(REPO_ROOT, 'src/services/leadIntake.ts'), 'utf8');

function main() {
  assert.match(
    screen,
    /GIRO_OPTIONS\.map/,
    'el alta debe mostrar el selector de giros (chips)',
  );
  assert.match(
    screen,
    /canalHint\(form\.giro\)/,
    'el alta debe mostrar el canal derivado del giro seleccionado',
  );
  assert.match(
    screen,
    /enqueue\('prospection', buildProspectionPayload\(form,/,
    'el alta debe encolar prospection con el payload del helper (cola offline intacta)',
  );
  assert.doesNotMatch(
    screen,
    /updateField\('canal'/,
    'el campo de canal de texto libre debe quedar reemplazado por el selector de giro',
  );
  assert.doesNotMatch(
    service,
    /x_wa_phone/,
    'el intake de leads no debe tocar el campo de WhatsApp del bot',
  );
  // el alta de lead NUNCA bloquea por teléfono
  assert.match(
    service,
    /normalizeMxPhoneSoft/,
    'el teléfono se normaliza suave (sin bloquear el alta)',
  );
  console.log('newcustomer giro wiring tests: ok');
}

main();
