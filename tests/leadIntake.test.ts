import assert from 'node:assert/strict';
import {
  buildProspectionPayload,
  canalHint,
  GIRO_OPTIONS,
  giroToCanal,
  normalizeMxPhoneSoft,
} from '../src/services/leadIntake.ts';

function testGiroMappingCoversRealChannels() {
  assert.equal(giroToCanal('abarrotes_miscelanea'), 'TRADICIONAL');
  assert.equal(giroToCanal('modelorama_deposito'), 'TRADICIONAL');
  assert.equal(giroToCanal('restaurante_fonda'), 'CENTROS_CONSUMO');
  assert.equal(giroToCanal('bar_micheladas'), 'CENTROS_CONSUMO');
  assert.equal(giroToCanal('super_conveniencia'), 'RETAIL');
  assert.equal(giroToCanal('eventos'), 'EVENTOS');
  assert.equal(giroToCanal('industria'), 'INDUSTRIAL');
  assert.equal(giroToCanal('hogar'), 'HOGAR');
  assert.equal(giroToCanal('otro'), null);
  assert.equal(giroToCanal('inexistente'), null);
  // todos los giros con canal usan códigos reales de gf.sales.channel
  const validos = new Set(['TRADICIONAL', 'CENTROS_CONSUMO', 'RETAIL', 'EVENTOS', 'INDUSTRIAL', 'HOGAR', 'DISTRIBUIDOR']);
  for (const g of GIRO_OPTIONS) {
    if (g.canal !== null) assert.ok(validos.has(g.canal), `canal inválido en ${g.slug}: ${g.canal}`);
  }
}

function testCanalHint() {
  assert.equal(canalHint('abarrotes_miscelanea'), 'Canal: Tradicional');
  assert.equal(canalHint('otro'), 'Se enviará a revisión de canal');
  assert.equal(canalHint(''), '');
}

function testPhoneSoftNormalization() {
  assert.equal(normalizeMxPhoneSoft('7333320269'), '+527333320269');
  assert.equal(normalizeMxPhoneSoft('521 733 332 0269'), '+527333320269');
  assert.equal(normalizeMxPhoneSoft('+52 733 332 0269'), '+527333320269');
  // suave: NUNCA bloquea — lo dudoso pasa tal cual
  assert.equal(normalizeMxPhoneSoft('0000000000'), '0000000000');
  assert.equal(normalizeMxPhoneSoft('733'), '733');
  assert.equal(normalizeMxPhoneSoft(''), '');
}

function testPayloadWithGiro() {
  const p = buildProspectionPayload(
    { nombre: '  Abarrotes Lupita ', telefono: '7333320269', direccion: ' Calle 5 ', giro: 'abarrotes_miscelanea', notas: 'frente a la plaza' },
    { latitude: 19.7, longitude: -101.19 },
  );
  assert.equal(p.contact_name, 'Abarrotes Lupita');
  assert.equal(p.mobile, '+527333320269');
  assert.equal(p.street, 'Calle 5');
  assert.equal(p.giro, 'abarrotes_miscelanea');
  assert.equal(p.x_canal, 'TRADICIONAL');
  assert.equal(p.x_source_channel, 'xvan');
  assert.equal(p.x_prospect_source, 'vendedor_campo');
  // degradación segura: giro y canal SIEMPRE legibles en description
  assert.match(String(p.description), /Giro: Abarrotes \/ Miscelánea/);
  assert.match(String(p.description), /Canal: TRADICIONAL/);
  assert.match(String(p.description), /frente a la plaza/);
  assert.equal(p.latitude, 19.7);
  assert.equal(p._source, 'nuevo_lead_ruta');
}

function testPayloadNoSeFallback() {
  const p = buildProspectionPayload(
    { nombre: 'Negocio X', telefono: '', direccion: '', giro: 'otro', notas: '' },
    { latitude: null, longitude: null },
  );
  assert.equal(p.x_canal, undefined);
  assert.equal(p.giro, 'otro');
  assert.match(String(p.description), /Canal: requiere revisión/);
  assert.equal(p.mobile, undefined);
  assert.equal(p.latitude, undefined);
}

function testPayloadSinGiroSeleccionado() {
  const p = buildProspectionPayload(
    { nombre: 'Negocio Y', telefono: '', direccion: '', giro: '', notas: 'solo nota' },
    {},
  );
  assert.equal(p.x_canal, undefined);
  assert.equal(p.giro, undefined);
  assert.equal(p.description, 'solo nota');
}

function testNuncaTocaWaPhone() {
  const p = buildProspectionPayload(
    { nombre: 'N', telefono: '7333320269', direccion: '', giro: 'hogar', notas: '' },
    {},
  );
  assert.equal('x_wa_phone' in p, false);
}

function main() {
  testGiroMappingCoversRealChannels();
  testCanalHint();
  testPhoneSoftNormalization();
  testPayloadWithGiro();
  testPayloadNoSeFallback();
  testPayloadSinGiroSeleccionado();
  testNuncaTocaWaPhone();
  console.log('lead intake tests: ok');
}

main();
