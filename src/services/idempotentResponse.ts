/**
 * Respuestas idempotentes del backend #116 (BLD-20260617-IDEMPOTENT).
 * Helpers PUROS / RN-free (node-testables).
 *
 * El backend #116 deduplica reintentos de cierre/liquidación y responde con un
 * código específico cuando la operación YA estaba hecha:
 *   - cerrar ruta      → `already_closed`
 *   - liquidación      → `already_confirmed`
 *
 * Para el vendedor, reintentar algo que el backend ya aplicó NO es un error: es
 * éxito idempotente. La app debe tratarlo como tal (no mostrar "No se pudo…").
 * Tolerante a ambas envolturas (ok:true+code u ok:false+throw) y a fallback por
 * mensaje si el code no llega. NO cambia el contrato: solo interpreta la
 * respuesta documentada.
 */

function matchesCodeOrMessage(
  code: string | null | undefined,
  message: string | null | undefined,
  codeNeedle: string,
  msgRegex: RegExp,
): boolean {
  if (typeof code === 'string' && code === codeNeedle) return true;
  return typeof message === 'string' && msgRegex.test(message);
}

/** ¿La respuesta indica que la ruta YA estaba cerrada (idempotente)? */
export function isAlreadyClosedResponse(
  code?: string | null,
  message?: string | null,
): boolean {
  return matchesCodeOrMessage(
    code, message,
    'already_closed',
    /already[_ ]?closed|ya (estaba|está|fue) cerrad/i,
  );
}

/** ¿La respuesta indica que la liquidación YA estaba confirmada (idempotente)? */
export function isAlreadyConfirmedResponse(
  code?: string | null,
  message?: string | null,
): boolean {
  return matchesCodeOrMessage(
    code, message,
    'already_confirmed',
    /already[_ ]?confirmed|ya (estaba|está|fue) confirmad/i,
  );
}
