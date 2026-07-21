export interface ThermalTicketDocument {
  schemaVersion: 1;
  branding: {
    logoPngBase64: string;
    logoVersion: string;
    legalName: string;
    rfcLabel: string;
    title: string;
    footer: string;
  };
  folio: string;
  formattedDate: string;
  customerName: string;
  sellerName: string;
  paymentLabel: string;
  lines: Array<{
    productId: number;
    productName: string;
    quantityAndUnitPrice: string;
    lineTotal: string;
  }>;
  subtotal: string;
  totalKg: string;
  total: string;
  creditNote?: string;
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
