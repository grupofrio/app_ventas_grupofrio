import type { GFVehicleChecklist } from '../types/routeStart';

export type VehicleChecklistBootstrapAction = 'create' | 'init' | 'read_checks';

export function getVehicleChecklistBootstrapAction(
  header: GFVehicleChecklist | null,
): VehicleChecklistBootstrapAction {
  if (!header) return 'create';
  if (header.state === 'draft') return 'init';
  return 'read_checks';
}

export function buildYesNoVehicleCheckAnswer(input: {
  value: boolean;
  expected?: boolean;
  reason?: string;
}): { result_bool: boolean; not_passed_reason?: string } {
  const trimmedReason = (input.reason || '').trim();
  const willFail = input.expected != null && input.value !== input.expected;
  if (!willFail) return { result_bool: input.value };

  return {
    result_bool: input.value,
    not_passed_reason: trimmedReason || 'Respuesta registrada en checklist de inicio.',
  };
}
