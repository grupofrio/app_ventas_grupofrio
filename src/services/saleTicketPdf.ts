import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildSaleTicketHtml, SaleTicketSnapshot } from './saleTicket.ts';
import { getSaleTicketPdfHeight } from './saleTicketPdfHeight.ts';

export { getSaleTicketPdfHeight } from './saleTicketPdfHeight.ts';

const TICKET_WIDTH_POINTS = 164; // 58mm at 72 PPI.

export async function createSaleTicketPdf(snapshot: SaleTicketSnapshot): Promise<string> {
  const { uri } = await Print.printToFileAsync({
    html: buildSaleTicketHtml(snapshot),
    width: TICKET_WIDTH_POINTS,
    height: getSaleTicketPdfHeight(snapshot),
    margins: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
  });
  return uri;
}

export async function openSaleTicketPdf(snapshot: SaleTicketSnapshot): Promise<string> {
  const uri = await createSaleTicketPdf(snapshot);
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('No hay visor disponible para abrir el PDF en este dispositivo.');
  }

  await Sharing.shareAsync(uri, {
    dialogTitle: 'Abrir ticket PDF',
    mimeType: 'application/pdf',
    UTI: '.pdf',
  });
  return uri;
}
