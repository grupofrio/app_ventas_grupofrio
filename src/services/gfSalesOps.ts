import { postRest } from './api';
import {
  parseGiftCreateResponse,
  type GiftCreateResult,
} from './salesOpsMutationOutcome';

export type { GiftCreateResponseData, GiftCreateResult } from './salesOpsMutationOutcome';

export async function createGift(
  payload: Record<string, unknown>,
): Promise<GiftCreateResult> {
  const result = await postRest<unknown>('/gf/salesops/gift/create', payload);
  return parseGiftCreateResponse(result);
}
