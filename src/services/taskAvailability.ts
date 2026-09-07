/**
 * The production tasks addon is deployed independently from the logistics API.
 * Keep this opt-in until that addon is installed, so optional tasks never turn
 * a successful operational refresh into an HTTP 404 error.
 */
export const TASKS_UNAVAILABLE_MESSAGE =
  'Las tareas operativas no están disponibles en este entorno por el momento.';

export function areEmployeeTasksEnabled(): boolean {
  return process.env.EXPO_PUBLIC_KF_TASKS_ENABLED?.trim().toLowerCase() === 'true';
}
