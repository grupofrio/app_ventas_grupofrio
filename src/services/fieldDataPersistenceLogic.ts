/**
 * Policy for records that contain employee-scoped operational or commercial
 * data. These are never eligible for plaintext AsyncStorage.
 */

export const ENCRYPTED_FIELD_DATA_KEYS = [
  'route:plan',
  'route:stops',
  'route:start',
  'visit:active',
  'entities:products',
  'cache:products:catalog',
  'cache:prices',
  'cache:consignments',
  'sync:queue',
  'sync:legacyRefreshPending',
] as const;

const encryptedFieldDataKeySet = new Set<string>(ENCRYPTED_FIELD_DATA_KEYS);

export function isEncryptedFieldDataKey(key: string): boolean {
  return encryptedFieldDataKeySet.has(key);
}
