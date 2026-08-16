/**
 * Inventory ledger domain types — RN-free.
 * Local/offline journal; Odoo remains final stock authority.
 */

export const INVENTORY_BUCKETS = [
  'sellable',
  'consigned',
  'return_good',
  'damaged',
  'pending',
] as const;

export type InventoryBucket = (typeof INVENTORY_BUCKETS)[number];

/** `physical` is derived, never stored as a mutable bucket. */
export type InventoryBucketOrDerived = InventoryBucket | 'physical';

export const MOVEMENT_TYPES = [
  'initial_load',
  'refill',
  'sale',
  'gift',
  'consignment_out',
  'consignment_return',
  'exchange_delivery',
  'exchange_return_good',
  'exchange_return_damaged',
  'return_good',
  'return_damaged',
  'adjustment',
  'reversal',
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const SYNC_STATUSES = [
  'pending',
  'processing',
  'synced',
  'retryable_error',
  'review_required',
  'rejected',
  'reversed',
] as const;

export type InventorySyncStatus = (typeof SYNC_STATUSES)[number];

export interface InventoryMovement {
  movement_id: string;
  operation_id: string;
  movement_type: MovementType;
  product_id: number;
  quantity: number;
  uom?: string | null;
  bucket_from: InventoryBucket | null;
  bucket_to: InventoryBucket | null;
  stop_id?: number | null;
  partner_id?: number | null;
  plan_id?: number | null;
  employee_id?: number | null;
  created_at: string;
  sync_status: InventorySyncStatus;
  server_reference?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProductBucketBalances {
  /**
   * Exact mathematical sellable. May be negative when local sales exceed the
   * referential snapshot (allowed; backend remains authority). Never clamp.
   */
  sellable: number;
  consigned: number;
  return_good: number;
  damaged: number;
  pending: number;
  /**
   * Derived van-held units: sellable + return_good + damaged + pending.
   * Consigned is NOT included (physically at customer).
   * May be negative when sellable is in deficit.
   */
  physical_van: number;
  /** Convenience: max(0, -sellable). Projection never hides deficit as 0. */
  sellable_deficit: number;
}

export type InventorySnapshot = Record<string, Partial<ProductBucketBalances> & { sellable?: number }>;

export interface LedgerState {
  version: 1;
  snapshot_version: string;
  snapshot_at: string;
  /** Baseline balances after last accepted server snapshot. */
  snapshot: InventorySnapshot;
  movements: InventoryMovement[];
}

export const EMPTY_BALANCES = (): ProductBucketBalances => ({
  sellable: 0,
  consigned: 0,
  return_good: 0,
  damaged: 0,
  pending: 0,
  physical_van: 0,
  sellable_deficit: 0,
});

export const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** UUID v4 (commercial op) or v5 (deterministic movement identity). */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuidV4(value: string, label: string): void {
  if (!UUID_V4_RE.test(value)) {
    throw new Error(`${label} must be a UUID v4`);
  }
}

export function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
}

export function withDerivedFields(balances: ProductBucketBalances): ProductBucketBalances {
  balances.physical_van =
    balances.sellable + balances.return_good + balances.damaged + balances.pending;
  balances.sellable_deficit = balances.sellable < 0 ? -balances.sellable : 0;
  return balances;
}
