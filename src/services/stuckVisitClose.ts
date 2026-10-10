/**
 * An in-progress stop whose evidence photo failed, or that is blocked because
 * another visit is current, must still be closable. The close does not wait
 * on the failed photo.
 */
export function shouldOfferStuckVisitClose(input: {
  stopState: string;
  hasAnotherActiveVisit: boolean;
  failedPhotoCount: number;
}): boolean {
  if (input.stopState !== 'in_progress') return false;
  return input.hasAnotherActiveVisit || input.failedPhotoCount > 0;
}

export function stuckVisitSaleTotal(input: {
  currentStopId: number | null;
  stopId: number;
  visitSaleTotal: number;
  /**
   * Server-accepted sale for this stop. A rejected cart, a gift, or "this
   * stop is not the current visit" is not a delivery.
   */
  hasSyncedSale?: boolean;
}): number {
  if (!input.hasSyncedSale) return 0;
  if (input.currentStopId === input.stopId) {
    return input.visitSaleTotal > 0 ? input.visitSaleTotal : 1;
  }
  // The sale that already synced is no longer in the cart.
  return 1;
}
