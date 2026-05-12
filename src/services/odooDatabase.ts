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

  try {
    const host = new URL(baseUrl).hostname;
    const match = host.match(/^([^.]+)\.odoo\.com$/);
    addUnique(candidates, match?.[1]);
  } catch {
    // Ignore invalid/local URLs; callers can still use the configured DB.
  }

  return candidates;
}

export async function fetchOdooDatabaseNames(baseUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/web/database/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', params: {} }),
    });
    const payload = await response.json();
    return extractOdooDatabaseNames(payload);
  } catch {
    return [];
  }
}
