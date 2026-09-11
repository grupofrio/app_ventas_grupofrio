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

/** A transport response without a lead id is not proof of creation. */
export function requireCreatedFieldLead(value: unknown): Record<string, unknown> {
  const lead = value as Record<string, unknown> | null;
  if (!lead || typeof lead.id !== 'number' || !Number.isInteger(lead.id) || lead.id <= 0) {
    throw new Error('No se pudo confirmar el registro del prospecto. Se reintentará con la misma operación.');
  }
  return lead;
}
