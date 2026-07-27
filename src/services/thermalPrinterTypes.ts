export interface ThermalTicketDocument {
  schemaVersion: 1;
  ticketKind?: 'sale' | 'exchange';
  branding: {
    logoPngBase64: string;
    logoVersion: string;
    legalName: string;
    rfcLabel: string;
    title: string;
    footer: string;
  };
  folio: string;
  localReference?: string;
  formattedDate: string;
  customerName: string;
  sellerName: string;
  paymentLabel: string;
  lines: Array<{
    productId: number;
    productName: string;
    quantityAndUnitPrice: string;
    lineTotal: string;
    sectionLabel?: 'ENTREGA' | 'MERMA';
  }>;
  subtotal: string;
  totalKg: string;
  total: string;
  creditNote?: string;
  exchangeNotes?: string;
}

export interface BondedBluetoothDevice {
  name: string | null;
  address: string;
}

export interface NativePrintProgress {
  transportBytesWritten: number;
  rasterBytesWritten: number;
  bandsCompleted: number;
  rasterPayloadAttempted: boolean;
}

export interface NativePrintResult extends NativePrintProgress {}

export function requiresManualReprintConfirmation(
  progress: Pick<NativePrintProgress, 'rasterPayloadAttempted'>,
): boolean {
  return progress.rasterPayloadAttempted;
}
