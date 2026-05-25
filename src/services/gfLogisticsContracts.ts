function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function pickOperationId(payload: Record<string, unknown>): string | null {
  return (
    asNonEmptyString(payload.operation_id) ??
    asNonEmptyString(payload.x_operation_id) ??
    asNonEmptyString(payload._operationId)
  );
}

function buildAnalyticDistribution(
  analyticPlazaId: number | null | undefined,
  analyticUnId: number | null | undefined,
): Record<string, number> | null {
  if (
    typeof analyticPlazaId !== 'number' ||
    analyticPlazaId <= 0 ||
    typeof analyticUnId !== 'number' ||
    analyticUnId <= 0
  ) {
    return null;
  }

  return {
    [String(analyticPlazaId)]: 100,
    [String(analyticUnId)]: 100,
  };
}

function normalizeSaleLine(line: Record<string, unknown>): Record<string, unknown> | null {
  const productId = asPositiveNumber(line.product_id);
  const quantity = asPositiveNumber(line.quantity) ?? asPositiveNumber(line.qty);
  if (!productId || !quantity) return null;

  const normalized: Record<string, unknown> = {
    product_id: productId,
    quantity,
    discount: typeof line.discount === 'number' ? line.discount : 0,
  };

  return normalized;
}

function normalizeExchangeLine(line: Record<string, unknown>): Record<string, unknown> | null {
  const productId = asPositiveNumber(line.product_id);
  const qty = asPositiveNumber(line.qty) ?? asPositiveNumber(line.quantity);
  if (!productId || !qty) return null;

  return {
    product_id: productId,
    qty,
  };
}

export function buildSalesCreatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const operationId = pickOperationId(payload);
  const partnerId = asPositiveNumber(payload.partner_id);
  const lines = Array.isArray(payload.lines)
    ? payload.lines
        .map((line) => (line && typeof line === 'object' ? normalizeSaleLine(line as Record<string, unknown>) : null))
        .filter((line): line is Record<string, unknown> => line !== null)
    : [];

  const contractPayload: Record<string, unknown> = {
    operation_id: operationId,
    partner_id: partnerId,
    lines,
  };

  const stopId = asPositiveNumber(payload.stop_id);
  if (stopId) contractPayload.stop_id = stopId;

  const warehouseId = asPositiveNumber(payload.warehouse_id);
  if (warehouseId) contractPayload.warehouse_id = warehouseId;

  const pricelistId = asPositiveNumber(payload.pricelist_id);
  if (pricelistId) contractPayload.pricelist_id = pricelistId;

  const analyticPlazaId = asPositiveNumber(payload.analytic_plaza_id);
  if (analyticPlazaId) contractPayload.analytic_plaza_id = analyticPlazaId;

  const analyticUnId = asPositiveNumber(payload.analytic_un_id);
  if (analyticUnId) contractPayload.analytic_un_id = analyticUnId;

  const analyticDistribution =
    payload.analytic_distribution && typeof payload.analytic_distribution === 'object'
      ? payload.analytic_distribution as Record<string, unknown>
      : buildAnalyticDistribution(analyticPlazaId, analyticUnId);
  if (analyticDistribution) contractPayload.analytic_distribution = analyticDistribution;

  if (payload.create_invoice === true) contractPayload.create_invoice = true;

  const note = asNonEmptyString(payload.note);
  if (note) contractPayload.note = note;

  if (payload._client_meta && typeof payload._client_meta === 'object') {
    contractPayload._client_meta = payload._client_meta;
  }

  return contractPayload;
}

export function buildPaymentsCreatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const operationId = pickOperationId(payload);
  const contractPayload: Record<string, unknown> = {
    operation_id: operationId,
    amount: payload.amount,
  };

  const saleOrderId = asPositiveNumber(payload.sale_order_id);
  if (saleOrderId) contractPayload.sale_order_id = saleOrderId;

  const partnerId = asPositiveNumber(payload.partner_id);
  if (partnerId) contractPayload.partner_id = partnerId;

  const stopId = asPositiveNumber(payload.stop_id);
  if (stopId) contractPayload.stop_id = stopId;

  const journalId = asPositiveNumber(payload.journal_id);
  if (journalId) contractPayload.journal_id = journalId;

  const paymentMethodLineId = asPositiveNumber(payload.payment_method_line_id);
  if (paymentMethodLineId) contractPayload.payment_method_line_id = paymentMethodLineId;

  const paymentDate = asNonEmptyString(payload.payment_date);
  if (paymentDate) contractPayload.payment_date = paymentDate;

  const reference = asNonEmptyString(payload.reference);
  if (reference) contractPayload.reference = reference;

  const currencyId = asPositiveNumber(payload.currency_id);
  if (currencyId) contractPayload.currency_id = currencyId;

  if (payload._client_meta && typeof payload._client_meta === 'object') {
    contractPayload._client_meta = payload._client_meta;
  }

  return contractPayload;
}

export function buildExchangeCreatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const analyticAccountId = asPositiveNumber(payload.analytic_account_id);
  const idempotencyKey =
    asNonEmptyString(payload.idempotency_key) ??
    pickOperationId(payload);
  const mobileLocationId = asPositiveNumber(payload.mobile_location_id);
  const partnerId = asPositiveNumber(payload.partner_id);
  const visitLineId = asPositiveNumber(payload.visit_line_id);
  const notes = asNonEmptyString(payload.notes);
  const validate = payload.validate === false ? false : true;
  const deliveryLines = Array.isArray(payload.delivery_lines)
    ? payload.delivery_lines
        .map((line) => (line && typeof line === 'object'
          ? normalizeExchangeLine(line as Record<string, unknown>)
          : null))
        .filter((line): line is Record<string, unknown> => line !== null)
    : [];
  const mermaLines = Array.isArray(payload.merma_lines)
    ? payload.merma_lines
        .map((line) => (line && typeof line === 'object'
          ? normalizeExchangeLine(line as Record<string, unknown>)
          : null))
        .filter((line): line is Record<string, unknown> => line !== null)
    : [];

  const meta: Record<string, unknown> = {
    idempotency_key: idempotencyKey,
  };
  if (analyticAccountId) meta.analytic_account_id = analyticAccountId;

  const data: Record<string, unknown> = {
    mobile_location_id: mobileLocationId,
    partner_id: partnerId,
    delivery_lines: deliveryLines,
    merma_lines: mermaLines,
    validate,
  };
  if (visitLineId) data.visit_line_id = visitLineId;
  if (notes) data.notes = notes;

  return { meta, data };
}
