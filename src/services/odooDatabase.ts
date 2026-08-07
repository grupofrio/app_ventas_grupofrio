const PUBLIC_DEFAULT_ODOO_DB = (process.env as Record<string, string | undefined>)[
  'EXPO_PUBLIC_KF_ODOO_DB'
]?.trim();

// DB de producción de la instancia grupofrio-gf. Es el fallback DETERMINISTA
// cuando `/web/database/list` no responde (list_db deshabilitado o red caída
// a media resolución): sin él, el único fallback sería el subdominio
// ("grupofrio-gf"), que NO es un nombre de DB válido en Odoo.sh. La lista del
// servidor sigue teniendo prioridad para sobrevivir renombres de DB sin
// recompilar el APK.
export const DEFAULT_ODOO_DB = PUBLIC_DEFAULT_ODOO_DB || 'grupofrio-gf-main-34980678';

function addUnique(candidates: string[], db?: string | null): void {
  const normalized = typeof db === 'string' ? db.trim() : '';
  if (normalized && !candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

export function extractOdooDatabaseNames(payload: unknown): string[] {
  const result = payload && typeof payload === 'object'
    ? (payload as { result?: unknown }).result
    : null;
  if (!Array.isArray(result)) return [];
  return result.filter((db): db is string => typeof db === 'string' && db.trim().length > 0);
}

export function candidateOdooDatabases(
  baseUrl: string,
  configuredDb?: string | null,
  listedDbs: string[] = [],
): string[] {
  const candidates: string[] = [];
  addUnique(candidates, configuredDb);
  listedDbs.forEach((db) => addUnique(candidates, db));
  addUnique(candidates, DEFAULT_ODOO_DB);

  try {
    const host = new URL(baseUrl).hostname;
    const match = host.match(/^([^.]+)\.odoo\.com$/);
    addUnique(candidates, match?.[1]);
  } catch {
    // Ignore invalid/local URLs; callers can still use the configured DB.
  }

  return candidates;
}

// Timeout de LECTURA local (este módulo se mantiene PURO/RN-free — no importa
// api.ts, que arrastra axios/SecureStore y rompería los tests de Node).
const DB_LIST_TIMEOUT_MS = 10_000;

export async function fetchOdooDatabaseNames(baseUrl: string): Promise<string[]> {
  // Sin timeout, el login quedaba colgado resolviendo la DB en red degradada
  // antes de siquiera intentar autenticar (pendiente de auditoría julio).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DB_LIST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/web/database/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', params: {} }),
      signal: controller.signal,
    });
    const payload = await response.json();
    return extractOdooDatabaseNames(payload);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Contrato de prioridad (idéntico al de candidateOdooDatabases):
 * explícita → lista del servidor → DEFAULT_ODOO_DB → subdominio.
 * Una DB explícita del caller gana SIEMPRE y evita la llamada de red:
 * la resolución queda determinista aun sin conectividad.
 */
export async function resolveOdooDatabase(
  baseUrl: string,
  configuredDb?: string | null,
  fetcher: (baseUrl: string) => Promise<string[]> = fetchOdooDatabaseNames,
): Promise<string | null> {
  const explicit = typeof configuredDb === 'string' ? configuredDb.trim() : '';
  if (explicit) return explicit;
  const listedDbs = await fetcher(baseUrl);
  const [listedDb] = listedDbs;
  if (listedDb) return listedDb;
  return candidateOdooDatabases(baseUrl, null, [])[0] ?? null;
}
