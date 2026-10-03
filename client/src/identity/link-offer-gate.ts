// Story 4.5 (FR143): the offer is decided as the scene is about to mount, and
// the mount never waits on anything the boot gate does not already wait on.
// By the time this runs the gate has verified the defs, so the handshake --
// and with it the subscription apply that carries the player's own character
// -- has arrived; an unreachable or timed-out gate never reaches here at all.
// The one thing that may still be missing is the first server-clock sample
// (today's city day), which is waited for once, bounded, never polled; a day
// that is still unknown is "not due".

export interface OfferGateDeps {
  readonly hasCarrier: boolean;
  readonly configured: boolean;
  /** The current city day, `undefined` until the clock has a sample. */
  readonly today: () => number | undefined;
  readonly firstClockSample: Promise<void>;
  /** Resolves after the bound (the boot gate's own timeout). */
  readonly timeout: () => Promise<void>;
  /** The pure decision, from the inputs known now. */
  readonly due: (today: number) => boolean;
}

export async function decideOffer(deps: OfferGateDeps): Promise<boolean> {
  if (!deps.hasCarrier || !deps.configured) return false;
  if (deps.today() === undefined) {
    await Promise.race([deps.firstClockSample, deps.timeout()]);
  }
  const today = deps.today();
  return today !== undefined && deps.due(today);
}
