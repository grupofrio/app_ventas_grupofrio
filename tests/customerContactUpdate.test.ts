import assert from 'node:assert/strict';
import {
  buildCustomerContactOdooWriteArgs,
  buildCustomerContactUpdatePayload,
  buildCustomerContactStopPatch,
  hasContactPhone,
  normalizeMxPhone,
  phoneChanged,
  validateCustomerContactForm,
} from '../src/services/customerContactUpdate.ts';

function testBuildsTrimmedPartnerPayload() {
  const payload = buildCustomerContactUpdatePayload(51063, {
    name: '  ABARROTES ESTRADA  ',
    contactName: '  Ana Lopez  ',
    phone: '  733 100 0000  ',
    mobile: '  733 200 0000  ',
    email: '  ana@example.com  ',
  });

  // Teléfonos válidos se guardan normalizados a E.164 MX.
  assert.deepEqual(payload, {
    id: 51063,
    name: 'ABARROTES ESTRADA',
    contact_name: 'Ana Lopez',
    phone: '+527331000000',
    mobile: '+527332000000',
    email: 'ana@example.com',
  });
}

function testEmptyOptionalFieldsBecomeFalseForOdooWrite() {
  const payload = buildCustomerContactUpdatePayload(51063, {
    name: 'Abarrotes Estrada',
    contactName: '',
    phone: ' ',
    mobile: '',
    email: '',
  });

  assert.deepEqual(payload, {
    id: 51063,
    name: 'Abarrotes Estrada',
    contact_name: false,
    phone: false,
    mobile: false,
    email: false,
  });
}

function testRejectsEmptyCustomerName() {
  const error = validateCustomerContactForm({
    name: ' ',
    contactName: 'Ana',
    phone: '',
    mobile: '',
    email: '',
  });

  assert.equal(error, 'El nombre del cliente es obligatorio.');
}

function testBuildsLocalStopPatch() {
  const patch = buildCustomerContactStopPatch({
    name: '  Nuevo Nombre  ',
    contactName: '  Beto  ',
    phone: '  555  ',
    mobile: '',
    email: ' correo@example.com ',
  });

  assert.deepEqual(patch, {
    customer_name: 'Nuevo Nombre',
    contact_name: 'Beto',
    phone: '555',
    mobile: '',
    email: 'correo@example.com',
  });
}

function testBuildsSafeOdooWriteArgs() {
  const args = buildCustomerContactOdooWriteArgs({
    id: 51063,
    name: 'Nuevo Nombre',
    contact_name: false,
    phone: '555',
    mobile: false,
    email: 'correo@example.com',
    _operationId: 'queue-id',
  });

  assert.deepEqual(args, [
    [51063],
    {
      name: 'Nuevo Nombre',
      phone: '555',
      mobile: false,
      email: 'correo@example.com',
    },
  ]);
}

function testNormalizeMxPhoneAcceptsValidFormats() {
  assert.deepEqual(normalizeMxPhone('7333320269'), { ok: true, e164: '+527333320269' });
  assert.deepEqual(normalizeMxPhone('+52 733 332 0269'), { ok: true, e164: '+527333320269' });
  assert.deepEqual(normalizeMxPhone('52-733-332-0269'), { ok: true, e164: '+527333320269' });
  assert.deepEqual(normalizeMxPhone('5217333320269'), { ok: true, e164: '+527333320269' });
  // Vacío permitido: el cliente puede no compartirlo.
  assert.deepEqual(normalizeMxPhone(''), { ok: true, e164: '' });
  assert.deepEqual(normalizeMxPhone('   '), { ok: true, e164: '' });
}

function testNormalizeMxPhoneRejectsGarbage() {
  for (const bad of ['0000000000', '1234567890', '9999999999', '7', '33554479580', '1235469875']) {
    const result = normalizeMxPhone(bad);
    assert.equal(result.ok, false, `debe rechazar ${bad}`);
  }
}

function testValidateRejectsInvalidPhoneButAllowsEmpty() {
  const base = { name: 'Cliente', contactName: '', email: '' };
  assert.match(
    validateCustomerContactForm({ ...base, phone: '0000000000', mobile: '' }) ?? '',
    /Teléfono/,
  );
  assert.match(
    validateCustomerContactForm({ ...base, phone: '', mobile: '12345' }) ?? '',
    /Móvil/,
  );
  assert.equal(validateCustomerContactForm({ ...base, phone: '', mobile: '' }), null);
  assert.equal(validateCustomerContactForm({ ...base, phone: '7333320269', mobile: '' }), null);
}

function testPhoneChangedIgnoresFormattingOnly() {
  assert.equal(phoneChanged('733 332 0269', '+527333320269'), false);
  assert.equal(phoneChanged('5217333320269', '7333320269'), false);
  assert.equal(phoneChanged('7333320269', '7333320260'), true);
  assert.equal(phoneChanged('7333320269', ''), true);
}

function testHasContactPhoneIgnoresWaPhone() {
  assert.equal(hasContactPhone({ phone: '7333320269', mobile: '' }), true);
  assert.equal(hasContactPhone({ phone: '', mobile: ' 733 111 2233 ' }), true);
  assert.equal(hasContactPhone({ phone: '  ', mobile: '' }), false);
  assert.equal(hasContactPhone({} as { phone?: string; mobile?: string }), false);
}

function testPayloadNeverTouchesWaPhone() {
  const payload = buildCustomerContactUpdatePayload(1, {
    name: 'Cliente',
    contactName: '',
    phone: '7333320269',
    mobile: '',
    email: '',
  });
  assert.equal('x_wa_phone' in payload, false);
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['contact_name', 'email', 'id', 'mobile', 'name', 'phone'],
  );

  const [, dict] = buildCustomerContactOdooWriteArgs({ ...payload, x_wa_phone: '+5215555' });
  assert.equal('x_wa_phone' in dict, false, 'el write a Odoo nunca incluye x_wa_phone');
}

function main() {
  testBuildsTrimmedPartnerPayload();
  testEmptyOptionalFieldsBecomeFalseForOdooWrite();
  testRejectsEmptyCustomerName();
  testBuildsLocalStopPatch();
  testBuildsSafeOdooWriteArgs();
  testNormalizeMxPhoneAcceptsValidFormats();
  testNormalizeMxPhoneRejectsGarbage();
  testValidateRejectsInvalidPhoneButAllowsEmpty();
  testPhoneChangedIgnoresFormattingOnly();
  testHasContactPhoneIgnoresWaPhone();
  testPayloadNeverTouchesWaPhone();
  console.log('customer contact update tests: ok');
}

main();
