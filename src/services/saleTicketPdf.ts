import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildSaleTicketHtml, SaleTicketSnapshot } from './saleTicket';

const TICKET_WIDTH_POINTS = 164; // 58mm at 72 PPI.
const BASE_TICKET_HEIGHT_POINTS = 330;
const LINE_HEIGHT_POINTS = 46;
const CREDIT_NOTE_HEIGHT_POINTS = 90;

export async function createSaleTicketPdf(snapshot: SaleTicketSnapshot): Promise<string> {
  const { uri } = await Print.printToFileAsync({
    html: buildSaleTicketHtml(snapshot),
    width: TICKET_WIDTH_POINTS,
    height: getTicketHeight(snapshot),
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

function getTicketHeight(snapshot: SaleTicketSnapshot): number {
  const creditNoteHeight = snapshot.paymentMethod === 'credit' ? CREDIT_NOTE_HEIGHT_POINTS : 0;
  return BASE_TICKET_HEIGHT_POINTS + snapshot.lines.length * LINE_HEIGHT_POINTS + creditNoteHeight;
}
