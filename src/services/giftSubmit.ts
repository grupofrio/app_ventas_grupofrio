/**
 * Decisión PURA de qué hacer cuando falla el registro de un regalo online.
 * RN-free / node-testable. Mantiene la política de errores explícita y probada:
 *   - sesión expirada → re-login (NO encolar: no es seguro sin auth válida);
 *   - error de red/retryable → encolar (no perder la captura en ruta);
 *   - error de validación/backend → mostrar error (NO encolar a ciegas).
 *
 * El caso offline (sin red antes de intentar) se encola directamente en la
 * pantalla sin pasar por aquí; este helper cubre el `catch` de un intento online.
 */
export type GiftSubmitAction = 'enqueue' | 'show_error' | 'session_relogin';

export function decideGiftFailureAction(input: {
  isSessionExpired: boolean;
  isRetryable: boolean;
}): GiftSubmitAction {
  if (input.isSessionExpired) return 'session_relogin';
  if (input.isRetryable) return 'enqueue';
  return 'show_error';
}
