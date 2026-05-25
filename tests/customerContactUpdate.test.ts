import assert from 'node:assert/strict';
import {
  buildCustomerContactOdooWriteArgs,
  buildCustomerContactUpdatePayload,
  buildCustomerContactStopPatch,
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

  assert.deepEqual(payload, {
    id: 51063,
    name: 'ABARROTES ESTRADA',
    contact_name: 'Ana Lopez',
    phone: '733 100 0000',
    mobile: '733 200 0000',
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

function main() {
  testBuildsTrimmedPartnerPayload();
  testEmptyOptionalFieldsBecomeFalseForOdooWrite();
  testRejectsEmptyCustomerName();
  testBuildsLocalStopPatch();
  testBuildsSafeOdooWriteArgs();
  console.log('customer contact update tests: ok');
}

main();
