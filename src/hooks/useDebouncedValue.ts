import { useEffect, useState } from 'react';

/**
 * Perf Fase 1: devuelve `value` retrasado `delayMs` tras el último cambio.
 *
 * Uso: el TextInput sigue ligado al estado inmediato (escribir se siente
 * instantáneo), pero el cálculo costoso (filtrar/ordenar 100-200 productos o
 * 30-100 paradas) consume el valor debounced → no se recalcula/renderiza en
 * cada tecla en celulares de bajo perfil.
 *
 * Sin dependencias nuevas; solo setTimeout + estado.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
