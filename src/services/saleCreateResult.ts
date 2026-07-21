export interface SaleCreateResultData {
  success: true;
  order_id: number;
  operation_id: string;
  duplicate?: boolean;
  [key: string]: unknown;
}

type InvalidSaleCreateResponseError = Error & {
  code: 'invalid_response';
  responseReceived: true;
};

function invalidSaleCreateResponse(): InvalidSaleCreateResponseError {
  const error = new Error('Respuesta inválida al confirmar la venta.') as InvalidSaleCreateResponseError;
  error.code = 'invalid_response';
  error.responseReceived = true;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateSaleCreateResult(
  result: unknown,
  expectedOperationId: string,
): SaleCreateResultData {
  try {
    if (!isRecord(result) || result.ok !== true || !isRecord(result.data)) {
      throw invalidSaleCreateResponse();
    }

    const data = result.data;
    if (
      data.success !== true
      || typeof data.order_id !== 'number'
      || !Number.isInteger(data.order_id)
      || data.order_id <= 0
      || typeof expectedOperationId !== 'string'
      || expectedOperationId.trim().length === 0
      || typeof data.operation_id !== 'string'
      || data.operation_id.trim().length === 0
      || data.operation_id !== expectedOperationId
      || (data.duplicate !== undefined && typeof data.duplicate !== 'boolean')
    ) {
      throw invalidSaleCreateResponse();
    }

    return data as SaleCreateResultData;
  } catch {
    throw invalidSaleCreateResponse();
  }
}
