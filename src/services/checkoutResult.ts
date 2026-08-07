export type CheckoutResultStatus = 'sale' | 'no_sale';

interface CheckoutResultInput {
  saleTotal: number;
  noSaleReasonId: number | null;
}

/**
 * Detalle estructurado de no-venta que el backend persiste en gf.route.stop
 * (no_sale_reason_code/no_sale_notes/no_sale_competitor). Un backend viejo
 * ignora estas claves sin error, así que se mandan siempre que existan.
 */
export interface NoSaleCheckoutDetail {
  noSaleReasonCode?: string | null;
  noSaleNotes?: string | null;
  noSaleCompetitor?: string | null;
}

interface BuildCheckoutPayloadInput extends CheckoutResultInput, NoSaleCheckoutDetail {
  stopId: number;
  latitude: number;
  longitude: number;
}

export function getCheckoutResultStatus({
  saleTotal,
  noSaleReasonId,
}: CheckoutResultInput): CheckoutResultStatus {
  if (saleTotal > 0) return 'sale';
  if (noSaleReasonId != null) return 'no_sale';
  return 'no_sale';
}

function cleanText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface CheckoutPayload {
  stop_id: number;
  latitude: number;
  longitude: number;
  result_status: CheckoutResultStatus;
  no_sale_reason_code?: string;
  no_sale_notes?: string;
  no_sale_competitor?: string;
}

export function buildCheckoutPayload({
  stopId,
  latitude,
  longitude,
  saleTotal,
  noSaleReasonId,
  noSaleReasonCode,
  noSaleNotes,
  noSaleCompetitor,
}: BuildCheckoutPayloadInput): CheckoutPayload {
  const payload: CheckoutPayload = {
    stop_id: stopId,
    latitude,
    longitude,
    result_status: getCheckoutResultStatus({ saleTotal, noSaleReasonId }),
  };

  // Solo en cierres sin venta y solo claves con contenido: un checkout de
  // venta nunca arrastra motivo, y el payload histórico queda idéntico.
  if (payload.result_status === 'no_sale') {
    const reasonCode = cleanText(noSaleReasonCode);
    const notes = cleanText(noSaleNotes);
    const competitor = cleanText(noSaleCompetitor);
    if (reasonCode) payload.no_sale_reason_code = reasonCode;
    if (notes) payload.no_sale_notes = notes;
    if (competitor) payload.no_sale_competitor = competitor;
  }

  return payload;
}
