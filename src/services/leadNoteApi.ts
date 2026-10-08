import type { ClientEventMeta } from '../utils/clientEvent.ts';
import { attachClientMetaToRestPayload } from '../utils/clientEvent.ts';
import { postRest } from './api.ts';
import { LEAD_NOTE_PATH, type LeadNoteWireBody } from './leadNote.ts';

/**
 * Same auth and envelope as lead/create: postRest sends the employee Bearer
 * token and unwraps the REST envelope. A 404 propagates as an API error so
 * the sync queue can hold the item.
 */
export async function postLeadNote(
  body: LeadNoteWireBody,
  meta?: ClientEventMeta | null,
): Promise<void> {
  const payload = attachClientMetaToRestPayload(
    { ...body } as Record<string, unknown>,
    meta ?? null,
  );
  await postRest(LEAD_NOTE_PATH, payload);
}
