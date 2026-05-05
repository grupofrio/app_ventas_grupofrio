export interface NoSaleReason {
  id: number;
  label: string;
  code: string;
}

export const NO_SALE_REASONS: NoSaleReason[] = [
  { id: 1, label: '🚪 Cerrado', code: 'closed' },
  { id: 2, label: '📦 Sin stock', code: 'no_stock' },
  { id: 3, label: '💰 Cobranza', code: 'collection' },
  { id: 4, label: '🏪 Ya tiene', code: 'has_stock' },
  { id: 5, label: '🥊 Competidor', code: 'competitor' },
  { id: 6, label: '👤 Sin encargado', code: 'no_contact' },
  { id: 7, label: '🔧 Servicio', code: 'service' },
  { id: 8, label: '💲 Precio', code: 'price' },
  { id: 9, label: '❄️ No tiene conservado', code: 'no_freezer' },
  { id: 10, label: '🙅 No tiene interés', code: 'no_interest' },
];
