import type { GFStop } from '../types/plan';

export function getPlanTypeLabel(generationMode?: string | null): string | null {
  if (!generationMode) return null;
  const normalized = generationMode.toLowerCase();
  if (normalized.includes('lead')) return 'Ruta de prospectos';
  if (normalized.includes('customer') || normalized.includes('client')) return 'Ruta de clientes';
  return null;
}

export function getStopTypeLabel(stop: Pick<GFStop, '_entityType' | '_isOffroute'>): string | null {
  if (!stop._entityType) return null;
  if (stop._isOffroute) {
    return stop._entityType === 'lead' ? 'Prospecto especial' : 'Cliente especial';
  }
  return stop._entityType === 'lead' ? 'Prospecto' : 'Cliente';
}
