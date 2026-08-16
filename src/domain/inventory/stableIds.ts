/**
 * Deterministic movement identities for the inventory ledger (RN-free).
 *
 * operation_id  = commercial UUID v4 (minted once, reused on retry)
 * movement_id   = UUID v5 derived from operation_id + semantic slot
 *
 * Same logical operation → same movement_id → append/projection dedupe.
 */

/** Namespace UUID for Kold Field inventory movement v5 ids (fixed). */
export const KF_INVENTORY_MOVEMENT_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
}

/** Minimal SHA-1 over raw bytes (RFC 3174). */
function sha1(bytes: Uint8Array): Uint8Array {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  const bitLen = bytes.length * 8;
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
  words[(((bytes.length + 8) >> 6) << 4) + 15] = bitLen;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Array<number>(80);
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t += 1) w[t] = words[i + t] | 0;
    for (let t = 16; t < 80; t += 1) {
      const n = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
      w[t] = (n << 1) | (n >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t += 1) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + (w[t] | 0)) | 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) | 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const hs = [h0, h1, h2, h3, h4];
  for (let i = 0; i < 5; i += 1) {
    out[i * 4] = (hs[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (hs[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (hs[i] >>> 8) & 0xff;
    out[i * 4 + 3] = hs[i] & 0xff;
  }
  return out;
}

function bytesToUuidV5(bytes: Uint8Array): string {
  const b = bytes.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 4122 UUID v5 from namespace UUID + name. */
export function uuidV5FromName(namespaceUuid: string, name: string): string {
  assertUuid(namespaceUuid, 'namespace');
  const nsHex = namespaceUuid.replace(/-/g, '');
  const nsBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    nsBytes[i] = parseInt(nsHex.slice(i * 2, i * 2 + 2), 16);
  }
  const nameBytes = new TextEncoder().encode(name);
  const joined = new Uint8Array(nsBytes.length + nameBytes.length);
  joined.set(nsBytes, 0);
  joined.set(nameBytes, nsBytes.length);
  return bytesToUuidV5(sha1(joined));
}

export function stableMovementId(operationId: string, semanticSlot: string): string {
  assertUuid(operationId, 'operation_id');
  return uuidV5FromName(
    KF_INVENTORY_MOVEMENT_NAMESPACE,
    `${operationId}|${semanticSlot}`,
  );
}

export function saleMovementSlot(productId: number, lineIndex: number): string {
  return `sale:product:${productId}:line:${lineIndex}`;
}

export function giftMovementSlot(productId: number, lineIndex: number): string {
  return `gift:product:${productId}:line:${lineIndex}`;
}

export function exchangeDeliverySlot(productId: number, lineIndex: number): string {
  return `exchange:delivery:product:${productId}:line:${lineIndex}`;
}

export function exchangeReturnGoodSlot(productId: number, lineIndex: number): string {
  return `exchange:return_good:product:${productId}:line:${lineIndex}`;
}

export function exchangeReturnDamagedSlot(productId: number, lineIndex: number): string {
  return `exchange:return_damaged:product:${productId}:line:${lineIndex}`;
}

export function reversalMovementSlot(originalMovementId: string): string {
  return `reversal:of:${originalMovementId}`;
}

export function stableReversalMovementId(originalMovementId: string): string {
  assertUuid(originalMovementId, 'original_movement_id');
  return uuidV5FromName(
    KF_INVENTORY_MOVEMENT_NAMESPACE,
    reversalMovementSlot(originalMovementId),
  );
}
