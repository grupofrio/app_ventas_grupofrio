export function unwrapRestResult(parsed: unknown, status: number): unknown {
  // Quick win (hardening): mensaje claro para sesión expirada. No hace logout
  // automático (eso sería refactor mayor de auth); solo da un error legible y
  // un code que la UI puede usar para guiar al re-login.
  if (status === 401) {
    const err = new Error('Sesión expirada. Vuelve a iniciar sesión.') as Error & { code: string };
    err.code = 'session_expired';
    throw err;
  }

  const envelope = parsed as Record<string, unknown> | null;
  const payload = envelope && typeof envelope === 'object' && 'result' in envelope
    ? envelope.result
    : parsed;

  const result = payload as Record<string, unknown> | null;
  if (result && typeof result === 'object' && result.ok === false) {
    const message = typeof result.message === 'string' && result.message.trim().length > 0
      ? result.message
      : `HTTP ${status}`;
    const err = new Error(message);
    // Attach the backend error code so callers can branch on it without
    // parsing the human-readable message string.
    if (typeof result.code === 'string' && result.code.length > 0) {
      (err as Error & { code: string }).code = result.code;
    }
    // También viaja un `error_code` dentro de `data` (p.ej. insufficient_stock).
    // Adjuntamos el `data` del backend al error para que el caller pueda mostrar
    // detalle por línea (available_qty real). Aditivo: no rompe a nadie.
    if (result.data && typeof result.data === 'object') {
      (err as Error & { data?: unknown }).data = result.data;
      const dataCode = (result.data as Record<string, unknown>).error_code;
      if (!(err as Error & { code?: string }).code && typeof dataCode === 'string' && dataCode) {
        (err as Error & { code: string }).code = dataCode;
      }
    }
    throw err;
  }

  return payload;
}
