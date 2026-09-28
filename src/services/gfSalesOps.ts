import { postRest } from './api';
import { buildGiftCreateContractPayload } from './giftPayload';
import {
  parseGiftCreateResponse,
  requireSalesOpsIdempotencyKey,
  type GiftCreateResult,
} from './salesOpsMutationOutcome';

export type { GiftCreateResponseData, GiftCreateResult } from './salesOpsMutationOutcome';

export async function createGift(
  payload: Record<string, unknown>,
): Promise<GiftCreateResult> {
  const contractPayload = buildGiftCreateContractPayload(payload);
  requireSalesOpsIdempotencyKey(contractPayload);
  const result = await postRest<unknown>('/gf/salesops/gift/create', contractPayload);
  return parseGiftCreateResponse(result);
}
