/**
 * Pure, native-module-free mechanics for KOLD Field's encrypted persistence.
 *
 * Every identity has exactly one native encrypted envelope. Replacing that
 * envelope is a single native write, so a day bundle can never be persisted as
 * a mixture of sections from two versions. `sessionId` here is a non-secret
 * session reference (never an Authorization/Bearer token).
 */

export interface EncryptedSessionIdentity {
  companyId: number;
  employeeId: number;
  sessionId: string;
}

export interface EncryptedStorageDriver {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface EncryptedSessionStore {
  clear(session: EncryptedSessionIdentity): Promise<void>;
  load<T>(session: EncryptedSessionIdentity, key: string): Promise<T | null>;
  remove(session: EncryptedSessionIdentity, key: string): Promise<void>;
  save<T>(session: EncryptedSessionIdentity, key: string, value: T): Promise<void>;
}

interface EncryptedEnvelope {
  version: 1;
  records: Record<string, string>;
}

const ENCRYPTED_STORE_PREFIX = 'kf-field-v1';
const RECORD_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/;
const SENSITIVE_RECORDS = new Set(['day-bundle', 'sync-queue']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Encrypted store requires a positive ${name}`);
  }
}

function normalizedSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error('Encrypted store requires a non-secret sessionId');
  }
  return normalized;
}

/**
 * This is a stable namespace discriminator, not a security primitive. The
 * input is explicitly a non-secret session reference, so it is never suitable
 * for an access token or other credential.
 */
function namespaceDiscriminator(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function getEncryptedSessionStorageKey(session: EncryptedSessionIdentity): string {
  assertPositiveSafeInteger(session.companyId, 'companyId');
  assertPositiveSafeInteger(session.employeeId, 'employeeId');
  const sessionId = normalizedSessionId(session.sessionId);
  return `${ENCRYPTED_STORE_PREFIX}.c${session.companyId}.e${session.employeeId}.s${namespaceDiscriminator(sessionId)}`;
}

function assertRecordKey(key: string): void {
  if (!RECORD_KEY_PATTERN.test(key)) {
    throw new Error('Encrypted store record key is invalid');
  }
}

/**
 * Explicit policy gate used by persistence callers during the migration. The
 * protected bundle/queue records must never be sent to plaintext AsyncStorage;
 * harmless preferences remain outside this encrypted session envelope.
 */
export function assertEncryptedRecord(
  key: string,
  storage: 'encrypted' | 'plaintext',
): void {
  assertRecordKey(key);
  if (storage === 'plaintext' && SENSITIVE_RECORDS.has(key)) {
    throw new Error(`Sensitive record ${key} must use encrypted storage`);
  }
}

function decodeEnvelope(raw: string | null): EncryptedEnvelope {
  if (raw === null) return { version: 1, records: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.records)) {
      throw new Error('invalid encrypted envelope');
    }
    const records: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.records)) {
      assertRecordKey(key);
      if (typeof value !== 'string') throw new Error('invalid encrypted record');
      records[key] = value;
    }
    return { version: 1, records };
  } catch {
    throw new Error('Encrypted store envelope is invalid');
  }
}

function encodeEnvelope(envelope: EncryptedEnvelope): string {
  return JSON.stringify(envelope);
}

function serializeRecord(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('Encrypted store cannot persist an undefined record');
  }
  return serialized;
}

function decodeRecord<T>(raw: string, key: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Encrypted store record ${key} is invalid`);
  }
}

export function createEncryptedSessionStore(
  driver: EncryptedStorageDriver,
): EncryptedSessionStore {
  const operationTails = new Map<string, Promise<void>>();

  async function serialize<T>(
    storageKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = operationTails.get(storageKey) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    operationTails.set(storageKey, tail);
    try {
      return await result;
    } finally {
      if (operationTails.get(storageKey) === tail) operationTails.delete(storageKey);
    }
  }

  return {
    async save<T>(
      session: EncryptedSessionIdentity,
      key: string,
      value: T,
    ): Promise<void> {
      assertEncryptedRecord(key, 'encrypted');
      const storageKey = getEncryptedSessionStorageKey(session);
      await serialize(storageKey, async () => {
        const envelope = decodeEnvelope(await driver.get(storageKey));
        envelope.records[key] = serializeRecord(value);
        await driver.put(storageKey, encodeEnvelope(envelope));
      });
    },

    async load<T>(
      session: EncryptedSessionIdentity,
      key: string,
    ): Promise<T | null> {
      assertEncryptedRecord(key, 'encrypted');
      const storageKey = getEncryptedSessionStorageKey(session);
      return serialize(storageKey, async () => {
        const envelope = decodeEnvelope(await driver.get(storageKey));
        const record = envelope.records[key];
        return record === undefined ? null : decodeRecord<T>(record, key);
      });
    },

    async remove(session: EncryptedSessionIdentity, key: string): Promise<void> {
      assertEncryptedRecord(key, 'encrypted');
      const storageKey = getEncryptedSessionStorageKey(session);
      await serialize(storageKey, async () => {
        const envelope = decodeEnvelope(await driver.get(storageKey));
        if (envelope.records[key] === undefined) return;
        delete envelope.records[key];
        if (Object.keys(envelope.records).length === 0) {
          await driver.remove(storageKey);
          return;
        }
        await driver.put(storageKey, encodeEnvelope(envelope));
      });
    },

    async clear(session: EncryptedSessionIdentity): Promise<void> {
      const storageKey = getEncryptedSessionStorageKey(session);
      await serialize(storageKey, () => driver.remove(storageKey));
    },
  };
}
