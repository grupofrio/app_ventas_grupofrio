/**
 * Converts the durable sync-queue idempotency key into the public REST
 * contract used to create a standalone field lead.
 */
export function buildFieldLeadCreatePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const { _operationId, ...body } = payload;
  const operationId = typeof _operationId === 'string' ? _operationId.trim() : '';

  if (!operationId) {
    throw new Error('Field lead creation requires a non-empty _operationId');
  }

  return {
    ...body,
    operation_id: operationId,
  };
}
