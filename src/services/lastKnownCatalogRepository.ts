import type { EncryptedSessionIdentity } from './encryptedStore.ts';
import { buildLastKnownCatalog, readLastKnownCatalog, rememberCatalogProduct, type CatalogIdentity } from './lastKnownCatalog.ts';

const KEY = 'cache:products:last-known';
export async function loadLastKnownCatalog(session: EncryptedSessionIdentity, context: CatalogIdentity) {
  if (session.companyId !== context.companyId || session.employeeId !== context.employeeId) return null;
  const { loadEncrypted } = await import('./encryptedStore.ts');
  return readLastKnownCatalog(await loadEncrypted(session, KEY), context);
}
export async function saveLastKnownCatalog(session: EncryptedSessionIdentity, context: CatalogIdentity, products: unknown[], fetchedAtMs: number) {
  if (session.companyId !== context.companyId || session.employeeId !== context.employeeId) return;
  const { updateEncryptedRecords } = await import('./encryptedStore.ts');
  await updateEncryptedRecords(session, records => {
    const previous = readLastKnownCatalog(records.getRecord(KEY), context);
    if (previous && previous.fetchedAtMs > fetchedAtMs) return;
    records.setRecord(KEY, buildLastKnownCatalog(context, products, fetchedAtMs, previous));
  });
}
export async function rememberLastKnownProduct(session: EncryptedSessionIdentity, context: CatalogIdentity, productId: number) {
  if (session.companyId !== context.companyId || session.employeeId !== context.employeeId) return;
  const { updateEncryptedRecords } = await import('./encryptedStore.ts');
  await updateEncryptedRecords(session, records => {
    const previous=readLastKnownCatalog(records.getRecord(KEY),context);
    if (previous) records.setRecord(KEY, rememberCatalogProduct(previous,productId,Date.now()));
  });
}
