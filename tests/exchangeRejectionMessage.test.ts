import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeExchangeRejection, VAN_OTHER_BRANCH_MESSAGE } from '../src/services/exchangeRejectionMessage.ts';
import { parseExchangeCreateResponse } from '../src/services/salesOpsMutationOutcome.ts';
import { unwrapRestResult } from '../src/utils/apiResult.ts';

const BRANCH = VAN_OTHER_BRANCH_MESSAGE;

describe('exchange rejection messages', () => {
  it('shows today\'s server message for FORBIDDEN instead of the branch sentence', () => {
    const message = describeExchangeRejection({
      code: 'FORBIDDEN',
      message: 'El empleado no tiene van asignada.',
    });
    assert.equal(message, 'El empleado no tiene van asignada.');
    assert.notEqual(message, BRANCH);
  });

  it('does not invent the branch sentence when FORBIDDEN has no message', () => {
    const message = describeExchangeRejection({ code: 'FORBIDDEN' });
    assert.equal(message, 'No se pudo registrar el cambio (FORBIDDEN).');
    assert.doesNotMatch(message, /sucursal activa/);
  });

  it('maps each known reason to a Spanish next step', () => {
    const cases: Array<[string, RegExp]> = [
      ['EMPLOYEE_NO_VAN', /no tiene van asignada/i],
      ['PLAN_VAN_MISMATCH', /no coincide/i],
      ['STOP_CLOSED', /antes del check-out/i],
      ['PLAN_NOT_ACTIVE', /no está activo/i],
      ['NOT_PLAN_MEMBER', /no estás asignado/i],
      ['NO_MERMA_MAP', /equivalencia de merma/i],
    ];
    for (const [reason, pattern] of cases) {
      const message = describeExchangeRejection({
        code: 'FORBIDDEN',
        message: 'detalle técnico',
        reason,
      });
      assert.match(message, pattern, reason);
      assert.doesNotMatch(message, /sucursal activa/, reason);
    }
  });

  it('uses the branch sentence only for VAN_OTHER_BRANCH', () => {
    assert.equal(
      describeExchangeRejection({ code: 'FORBIDDEN', reason: 'VAN_OTHER_BRANCH' }),
      BRANCH,
    );
    assert.equal(
      describeExchangeRejection({ code: 'FORBIDDEN', detail_code: 'VAN_OTHER_BRANCH', message: 'otro texto' }),
      BRANCH,
    );
  });

  it('reads reason and detail_code from data and accepts hyphenated codes', () => {
    assert.match(
      describeExchangeRejection({
        code: 'FORBIDDEN',
        data: { detail_code: 'stop-closed' },
      }),
      /parada ya está cerrada/i,
    );
    assert.match(
      describeExchangeRejection({
        code: 'FORBIDDEN',
        data: { reason: 'PLAN_NOT_ACTIVE' },
      }),
      /plan de ruta no está activo/i,
    );
  });

  it('prefers message, then user_message, when no known reason exists', () => {
    assert.equal(
      describeExchangeRejection({
        code: 'VALIDATION_ERROR',
        message: 'La cantidad debe ser mayor a cero.',
        user_message: 'Revisa la cantidad.',
      }),
      'La cantidad debe ser mayor a cero.',
    );
    assert.equal(
      describeExchangeRejection({
        code: 'VALIDATION_ERROR',
        user_message: 'Revisa la cantidad.',
      }),
      'Revisa la cantidad.',
    );
  });

  it('includes product and available quantity for INSUFFICIENT_STOCK', () => {
    const message = describeExchangeRejection({
      code: 'INSUFFICIENT_STOCK',
      message: 'Stock insuficiente',
      data: {
        product_name: 'Barra 5kg',
        available_qty: 2,
      },
    });
    assert.match(message, /Barra 5kg/);
    assert.match(message, /disponible 2/);
    assert.match(message, /baja la cantidad|otro producto/i);
  });

  it('reads insufficient stock lines and highlights a zero balance', () => {
    const message = describeExchangeRejection({
      code: 'insufficient_stock',
      data: {
        lines: [
          { product_id: 9, product_name: 'Hielo Barra', available_qty: 0 },
          { product_name: 'Barra 10kg', available: 1.5 },
        ],
      },
    });
    assert.match(message, /Hielo Barra está agotado/);
    assert.match(message, /Barra 10kg: disponible 1\.5/);
  });

  it('falls back to the server message when stock details are missing', () => {
    assert.equal(
      describeExchangeRejection({
        code: 'INSUFFICIENT_STOCK',
        message: 'No alcanza la existencia de la unidad.',
      }),
      'No alcanza la existencia de la unidad.',
    );
  });

  it('uses a generic sentence that includes the code when nothing else is present', () => {
    assert.equal(
      describeExchangeRejection({ code: 'VALIDATION_ERROR' }),
      'No se pudo registrar el cambio (VALIDATION_ERROR).',
    );
    assert.match(describeExchangeRejection({}), /sin código/);
    assert.match(describeExchangeRejection(new Error('   ')), /sin código/);
  });

  it('keeps the busy and misconfig copy only when the server sent no sentence', () => {
    assert.match(describeExchangeRejection({ code: 'LOCK_BUSY' }), /ocupado/i);
    assert.equal(
      describeExchangeRejection({ code: 'SERVER_MISCONFIG', message: 'Falta la ubicación de merma.' }),
      'Falta la ubicación de merma.',
    );
    assert.match(describeExchangeRejection({ code: 'SERVER_MISCONFIG' }), /administrador/i);
  });

  it('reads the fields unwrapRestResult keeps from today\'s envelope and from the new reason', () => {
    assert.throws(
      () => unwrapRestResult({
        ok: false,
        code: 'FORBIDDEN',
        message: 'La parada ya está cerrada.',
      }, 403),
      (error: unknown) => {
        assert.equal(describeExchangeRejection(error), 'La parada ya está cerrada.');
        assert.doesNotMatch(describeExchangeRejection(error), /sucursal activa/);
        return true;
      },
    );

    assert.throws(
      () => unwrapRestResult({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Employee has no van',
        reason: 'EMPLOYEE_NO_VAN',
        user_message: 'Sin van',
        data: { product_name: 'no aplica' },
      }, 403),
      (error: unknown) => {
        const rejected = error as { reason?: string; user_message?: string };
        assert.equal(rejected.reason, 'EMPLOYEE_NO_VAN');
        assert.equal(rejected.user_message, 'Sin van');
        assert.match(describeExchangeRejection(error), /pide a supervisión que la asigne/);
        return true;
      },
    );
  });

  it('keeps reason on the sales-ops parser error', () => {
    assert.throws(
      () => parseExchangeCreateResponse({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Cerrada',
        detail_code: 'STOP_CLOSED',
        user_message: 'Cambio procesado',
        data: {},
      }, { requireDeliveryPicking: false, requireMermaPicking: false }),
      (error: unknown) => {
        assert.match(describeExchangeRejection(error), /antes del check-out/);
        return true;
      },
    );
  });
});
