import assert from 'node:assert/strict';
import {
  buildCustomerContactUpdatePayload,
  hasContactPhone,
  normalizeEmployeeCustomerContactUpdate,
  normalizeMxPhone,
  phoneChanged,
  validateCustomerContactForm,
} from '../src/services/customerContactUpdateLogic.ts';

function testBuildsTrimmedPartnerPayload() {
  const payload = buildCustomerContactUpdatePayload(51063, {
    name: '  ABARROTES ESTRADA  ',
    phone: '  733 100 0000  ',
    mobile: '  733 200 0000  ',
    email: '  ana@example.com  ',
  });

  // Teléfonos válidos se guardan normalizados a E.164 MX dentro del
  // contrato REST allowlisted.
  assert.deepEqual(payload, {
    partner_id: 51063,
    values: {
      name: 'ABARROTES ESTRADA',
      phone: '+527331000000',
      mobile: '+527332000000',
      email: 'ana@example.com',
    },
  });
}

function testEmptyOptionalFieldsBecomeFalseForEmployeeRest() {
  const payload = buildCustomerContactUpdatePayload(51063, {
    name: 'Abarrotes Estrada',
    phone: ' ',
    mobile: '',
    email: '',
  });

  assert.deepEqual(payload, {
    partner_id: 51063,
    values: {
      name: 'Abarrotes Estrada',
      phone: false,
      mobile: false,
      email: false,
    },
  });
}

function testRejectsEmptyCustomerName() {
  const error = validateCustomerContactForm({
    name: ' ',
    phone: '',
    mobile: '',
    email: '',
  });

  assert.equal(error, 'El nombre del cliente es obligatorio.');
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
  const base = { name: 'Cliente', email: '' };
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
    phone: '7333320269',
    mobile: '',
    email: '',
  });
  assert.equal('x_wa_phone' in payload, false);
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['partner_id', 'values'],
  );
  assert.equal('contact_name' in payload.values, false, 'contact_name no está allowlisted para REST');
  assert.equal('x_wa_phone' in payload.values, false, 'x_wa_phone no está allowlisted para REST');
}

function testSyncPayloadStripsQueueMetadataAndNonAllowlistedValues() {
  const payload = normalizeEmployeeCustomerContactUpdate({
    partner_id: 51063,
    values: {
      name: 'Cliente actualizado',
      phone: '+527333320269',
      mobile: false,
      email: 'cliente@example.com',
      contact_name: 'No se envía',
      vat: 'No se envía',
    },
    _operationId: 'queue-only',
  });

  assert.deepEqual(payload, {
    partner_id: 51063,
    values: {
      name: 'Cliente actualizado',
      phone: '+527333320269',
      mobile: false,
      email: 'cliente@example.com',
    },
  });
}

function main() {
  testBuildsTrimmedPartnerPayload();
  testEmptyOptionalFieldsBecomeFalseForEmployeeRest();
  testRejectsEmptyCustomerName();
  testNormalizeMxPhoneAcceptsValidFormats();
  testNormalizeMxPhoneRejectsGarbage();
  testValidateRejectsInvalidPhoneButAllowsEmpty();
  testPhoneChangedIgnoresFormattingOnly();
  testHasContactPhoneIgnoresWaPhone();
  testPayloadNeverTouchesWaPhone();
  testSyncPayloadStripsQueueMetadataAndNonAllowlistedValues();
  console.log('customer contact update tests: ok');
}

main();
