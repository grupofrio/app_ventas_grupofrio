import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { buildExchangeTicketHtml, type ExchangeTicketSnapshot } from './exchangeTicket.ts';

const TICKET_WIDTH_POINTS = 164; // 58mm at 72 PPI.
const BASE_TICKET_HEIGHT_POINTS = 280;
const LINE_HEIGHT_POINTS = 28;
const NOTES_BASE_HEIGHT_POINTS = 36;
const NOTES_WRAP_HEIGHT_POINTS = 16;
const NOTES_WRAP_CHARACTERS = 32;

export async function createExchangeTicketPdf(snapshot: ExchangeTicketSnapshot): Promise<string> {
  const { uri } = await Print.printToFileAsync({
    html: buildExchangeTicketHtml(snapshot),
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

export async function openExchangeTicketPdf(snapshot: ExchangeTicketSnapshot): Promise<string> {
  const uri = await createExchangeTicketPdf(snapshot);
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('No hay visor disponible para abrir el PDF en este dispositivo.');
  }

  await Sharing.shareAsync(uri, {
    dialogTitle: 'Abrir ticket de cambio en PDF',
    mimeType: 'application/pdf',
    UTI: '.pdf',
  });

  return uri;
}

function getTicketHeight(snapshot: ExchangeTicketSnapshot): number {
  const lineCount = snapshot.deliveryLines.length + snapshot.mermaLines.length;
  const notesHeight = snapshot.notes
    ? NOTES_BASE_HEIGHT_POINTS
      + Math.ceil(snapshot.notes.length / NOTES_WRAP_CHARACTERS) * NOTES_WRAP_HEIGHT_POINTS
    : 0;

  return BASE_TICKET_HEIGHT_POINTS + lineCount * LINE_HEIGHT_POINTS + notesHeight;
}
