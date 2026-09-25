// A skew estimate of the server's clock, held as one anchor against the
// monotonic clock. The wall clock is never read here: an NTP step or a
// user changing their system clock cannot move what this returns. `perfNow`
// is injected (`performance.now` in production).

/** A sample whose round trip is longer than this says too little about the
 * server's clock to be trusted. */
export const MAX_ROUND_TRIP_MS = 2_000;

export class ServerClock {
  readonly #perfNow: () => number;
  #hasSample = false;
  #anchorServerMicros = 0n;
  #anchorPerfMs = 0;

  constructor(perfNow: () => number) {
    this.#perfNow = perfNow;
  }

  /** Records one stamped round trip: `serverMicros` is what the server
   * stamped, `tSendMs`/`tRecvMs` the monotonic readings around the call.
   * Returns whether the sample was accepted. */
  observe(tSendMs: number, tRecvMs: number, serverMicros: bigint): boolean {
    if (tRecvMs - tSendMs > MAX_ROUND_TRIP_MS) return false;
    // The server stamped at the round trip's midpoint.
    this.#anchorPerfMs = (tSendMs + tRecvMs) / 2;
    this.#anchorServerMicros = serverMicros;
    this.#hasSample = true;
    return true;
  }

  /** The server's clock in microseconds since the Unix epoch, or
   * `undefined` before the first accepted sample. */
  nowMicros(): bigint | undefined {
    if (!this.#hasSample) return undefined;
    const sinceAnchorMs = this.#perfNow() - this.#anchorPerfMs;
    return this.#anchorServerMicros + BigInt(Math.round(sinceAnchorMs * 1000));
  }
}
