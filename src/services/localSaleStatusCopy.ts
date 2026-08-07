/**
 * Copy y tono visual de los estados locales de venta en la pestaña Ventas.
 * Devuelve tokens de tono, no colores de componente: el tema decide.
 */

import type { LocalSaleStatus } from './salesListProjection';

export type LocalSaleTone = 'pending' | 'active' | 'warning' | 'danger';

export interface LocalSaleStatusCopy {
  label: string;
  tone: LocalSaleTone;
}

const STATUS_COPY: Record<LocalSaleStatus, LocalSaleStatusCopy> = {
  pending: { label: 'Pendiente de sincronizar', tone: 'pending' },
  syncing: { label: 'Sincronizando', tone: 'active' },
  retrying: { label: 'Reintentando', tone: 'warning' },
  needs_attention: { label: 'Requiere atención', tone: 'danger' },
  updating: { label: 'Actualizando', tone: 'active' },
};

export function describeLocalSaleStatus(status: LocalSaleStatus): LocalSaleStatusCopy {
  return STATUS_COPY[status];
}

export const LOCAL_AMOUNT_UNAVAILABLE_LABEL = 'Monto no disponible';
