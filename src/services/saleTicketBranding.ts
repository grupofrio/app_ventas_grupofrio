import { SALE_TICKET_LOGO_PNG_BASE64 } from '../generated/saleTicketLogo.ts';

export const SALE_TICKET_BRANDING = {
  version: 'grupo-frio-ticket-v1',
  legalName: 'SOLUCIONES EN PRODUCCION GLACIEM',
  rfcLabel: 'RFC: SPG230420F52',
  title: 'Ticket de venta',
  footer: 'Gracias por su compra',
  logoPngBase64: SALE_TICKET_LOGO_PNG_BASE64,
} as const;
