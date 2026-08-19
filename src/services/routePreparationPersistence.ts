/**
 * Encrypted persistence for the route preparation receipt.
 */

import { storeLoad, storeRemove, storeSave, STORAGE_KEYS } from '../persistence/storage.ts';
import type { EncryptedSessionIdentity } from './encryptedStore.ts';
import {
  buildRoutePreparationReceipt,
  parseRoutePreparationReceipt,
  type RoutePreparationReceiptV1,
} from './routePreparationReceipt.ts';

export const ROUTE_PREPARATION_RECORD_KEY = 'route:preparation' as const;

export async function loadRoutePreparationReceipt(): Promise<RoutePreparationReceiptV1 | null> {
  const raw = await storeLoad<unknown>(STORAGE_KEYS.ROUTE_PREPARATION);
  return parseRoutePreparationReceipt(raw);
}

export async function saveRoutePreparationReceipt(
  receipt: RoutePreparationReceiptV1,
): Promise<void> {
  const validated = parseRoutePreparationReceipt(receipt);
  if (!validated) {
    throw new Error('Route preparation receipt rejected before persist.');
  }
  await storeSave(STORAGE_KEYS.ROUTE_PREPARATION, validated);
}

export async function clearRoutePreparationReceipt(): Promise<void> {
  await storeRemove(STORAGE_KEYS.ROUTE_PREPARATION);
}

export async function applyRoutePreparationReauthTransfer(input: {
  previousSession: EncryptedSessionIdentity;
  nextSession: EncryptedSessionIdentity;
  load: (session: EncryptedSessionIdentity, key: typeof ROUTE_PREPARATION_RECORD_KEY) => Promise<unknown | null>;
  save: (session: EncryptedSessionIdentity, key: typeof ROUTE_PREPARATION_RECORD_KEY, value: RoutePreparationReceiptV1) => Promise<void>;
}): Promise<{ transferred: boolean }> {
  const { previousSession, nextSession, load, save } = input;
  if (
    previousSession.companyId !== nextSession.companyId
    || previousSession.employeeId !== nextSession.employeeId
    || previousSession.sessionId === nextSession.sessionId
  ) {
    return { transferred: false };
  }

  const raw = await load(previousSession, ROUTE_PREPARATION_RECORD_KEY);
  const receipt = parseRoutePreparationReceipt(raw);
  if (!receipt) return { transferred: false };

  if (
    receipt.identity.companyId !== nextSession.companyId
    || receipt.identity.employeeId !== nextSession.employeeId
  ) {
    return { transferred: false };
  }

  await save(nextSession, ROUTE_PREPARATION_RECORD_KEY, receipt);
  return { transferred: true };
}

export async function transferRoutePreparationReceiptForReauthentication(
  previousSession: EncryptedSessionIdentity,
  nextSession: EncryptedSessionIdentity,
): Promise<{ transferred: boolean }> {
  const { loadEncrypted, saveEncrypted } = await import('./encryptedStore.ts');
  return applyRoutePreparationReauthTransfer({
    previousSession,
    nextSession,
    load: loadEncrypted,
    save: saveEncrypted,
  });
}

export { buildRoutePreparationReceipt };
