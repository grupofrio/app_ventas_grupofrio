import { readPositiveStopId, rememberStopRemap } from './stopIdRemap.ts';

/**
 * When a virtual visit learns its real route stop, rewrite the local stop,
 * the open visit, and queued photos/exchanges that still point at the
 * negative id. Returns the id later operations should use.
 */
export async function adoptServerStopFromResponse(
  requestedStopId: number,
  response: unknown,
): Promise<number> {
  const serverStopId = readPositiveStopId(response);
  if (!(requestedStopId < 0) || !serverStopId || serverStopId === requestedStopId) {
    return requestedStopId;
  }
  rememberStopRemap(requestedStopId, serverStopId);
  const { useRouteStore } = await import('../stores/useRouteStore.ts');
  const { useVisitStore } = await import('../stores/useVisitStore.ts');
  useRouteStore.getState().replaceStopId(requestedStopId, serverStopId);
  useVisitStore.getState().adoptServerStopId(requestedStopId, serverStopId);
  return serverStopId;
}
