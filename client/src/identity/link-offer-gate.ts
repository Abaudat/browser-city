// Story 4.5 (FR143): the offer is decided as the scene is about to mount, and
// the mount never waits on anything the boot gate does not already wait on.
// The gate mounts the fetched defs even when the server was unreachable, so
// this does run on that path: with no handshake there is no subscription
// apply and no clock sample can ever land, so the decision is "not due" at
// once, with no wait. Only a settled handshake -- whose subscription apply
// carries the player's own character -- may wait for the first server-clock
// sample (today's city day), once, bounded, never polled; a day still unknown
// is "not due".

export interface OfferGateDeps {
  readonly hasCarrier: boolean;
  readonly configured: boolean;
  /** The boot gate's own outcome: a handshake arrived (false: the server was
   * unreachable or the gate timed out). */
  readonly handshakeSettled: boolean;
  /** The current city day, `undefined` until the clock has a sample. */
  readonly today: () => number | undefined;
  readonly firstClockSample: Promise<void>;
  /** Resolves after the bound (the boot gate's own timeout). */
  readonly timeout: () => Promise<void>;
  /** The pure decision, from the inputs known now. */
  readonly due: (today: number) => boolean;
}

export async function decideOffer(deps: OfferGateDeps): Promise<boolean> {
  if (!deps.hasCarrier || !deps.configured || !deps.handshakeSettled) return false;
  if (deps.today() === undefined) {
    await Promise.race([deps.firstClockSample, deps.timeout()]);
  }
  const today = deps.today();
  return today !== undefined && deps.due(today);
}
