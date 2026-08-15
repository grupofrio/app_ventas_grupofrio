import type { EncryptedSessionIdentity } from './encryptedStore.ts';

interface FieldDataIdentity {
  companyId: number;
  employeeId: number;
}

let activeIdentity: FieldDataIdentity | null = null;

export function setFieldDataIdentity(identity: FieldDataIdentity): void {
  activeIdentity = { ...identity };
}

export function clearFieldDataIdentity(): void {
  activeIdentity = null;
}

export async function getFieldDataSession(): Promise<EncryptedSessionIdentity | null> {
  if (!activeIdentity) return null;
  // Keep the native auth dependency out of non-field-storage code paths (such
  // as printer preferences) until an encrypted operational record is touched.
  const { getAuthSessionId } = await import('./api.ts');
  const sessionId = await getAuthSessionId();
  if (!sessionId) return null;
  return { ...activeIdentity, sessionId };
}
