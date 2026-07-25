import type { LocalSaleStatus } from './salesListProjection.ts';
import type { BadgeVariant } from '../theme/tokens.ts';

export type SaleDisplayStatus =
  | LocalSaleStatus
  | 'error'
  | 'synced'
  | 'unknown';

export interface SaleStatusCopy {
  label: string;
  detail: string;
  tone: BadgeVariant;
  actionable: boolean;
}

const STATUS_COPY: Record<SaleDisplayStatus, SaleStatusCopy> = {
  pending: {
    label: 'Pendiente',
    detail: 'Se enviará cuando haya conexión.',
    tone: 'yellow',
    actionable: false,
  },
  syncing: {
    label: 'Enviando',
    detail: 'Sincronizando con Odoo.',
    tone: 'blue',
    actionable: false,
  },
  retrying: {
    label: 'Reintento pendiente',
    detail: 'Revisa la conexión o Sincronización.',
    tone: 'yellow',
    actionable: true,
  },
  error: {
    label: 'Reintento pendiente',
    detail: 'Revisa la conexión o Sincronización.',
    tone: 'yellow',
    actionable: true,
  },
  needs_attention: {
    label: 'Requiere atención',
    detail: 'Revisa esta venta en Sincronización.',
    tone: 'red',
    actionable: true,
  },
  updating: {
    label: 'Actualizando',
    detail: 'Esperando confirmación de Odoo.',
    tone: 'blue',
    actionable: false,
  },
  synced: {
    label: 'Sincronizada',
    detail: 'Confirmada en Odoo.',
    tone: 'green',
    actionable: false,
  },
  unknown: {
    label: 'Estado no disponible',
    detail: 'No se pudo confirmar el estado.',
    tone: 'dim',
    actionable: false,
  },
};

export function getSaleStatusCopy(status: SaleDisplayStatus): SaleStatusCopy {
  return STATUS_COPY[status];
}
