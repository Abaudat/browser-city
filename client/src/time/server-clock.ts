// A skew estimate of the server's clock, held as one anchor against the
// monotonic clock. The wall clock is never read here: an NTP step or a
// user changing their system clock cannot move what this returns. `perfNow`
// is injected (`performance.now` in production).

/** A sample whose round trip is longer than this says too little about the
 * server's clock to be trusted. */
export const MAX_ROUND_TRIP_MS = 2_000;

/** While a correction is being absorbed, the reading runs at this much
 * faster or slower than real time (so it never stops and never steps back). */
const SLEW_RATE = 0.5;

/** A forward correction larger than this is a machine that slept or a bad
 * start, not drift: the reading steps to it at once. */
const SLEW_LIMIT_MICROS = 5_000_000;

export class ServerClock {
  readonly #perfNow: () => number;
  #hasSample = false;
  #anchorServerMicros = 0n;
  #anchorPerfMs = 0;
  #sampleWaiters: Array<() => void> = [];
  /** Microseconds the reading is ahead (positive) or behind (negative) the
   * newest estimate, shrinking at SLEW_RATE. */
  #offsetMicros = 0;
  #lastReadPerfMs = 0;

  constructor(perfNow: () => number) {
    this.#perfNow = perfNow;
  }

  /** Records one stamped round trip: `serverMicros` is what the server
   * stamped, `tSendMs`/`tRecvMs` the monotonic readings around the call.
   * Returns whether the sample was accepted. */
  observe(tSendMs: number, tRecvMs: number, serverMicros: bigint): boolean {
    if (tRecvMs - tSendMs > MAX_ROUND_TRIP_MS) return false;
    const before = this.nowMicros();
    // The server stamped at the round trip's midpoint.
    this.#anchorPerfMs = (tSendMs + tRecvMs) / 2;
    this.#anchorServerMicros = serverMicros;
    this.#hasSample = true;
    // The reading stays where it was; the gap to the new estimate is slewed
    // away, unless it is a large step forward.
    const gap = before === undefined ? 0 : Number(before - this.#rawMicros());
    this.#offsetMicros = gap < -SLEW_LIMIT_MICROS ? 0 : gap;
    for (const resolve of this.#sampleWaiters) resolve();
    this.#sampleWaiters = [];
    return true;
  }

  /** Resolves on the first accepted sample, at once if there already is one. */
  whenSampled(): Promise<void> {
    if (this.#hasSample) return Promise.resolve();
    return new Promise((resolve) => {
      this.#sampleWaiters.push(resolve);
    });
  }

  /** The server's clock in microseconds since the Unix epoch, or
   * `undefined` before the first accepted sample. */
  nowMicros(): bigint | undefined {
    if (!this.#hasSample) return undefined;
    const now = this.#perfNow();
    const elapsedMicros = Math.max(0, now - this.#lastReadPerfMs) * 1000;
    this.#lastReadPerfMs = now;
    const absorbed = Math.min(Math.abs(this.#offsetMicros), elapsedMicros * SLEW_RATE);
    this.#offsetMicros -= Math.sign(this.#offsetMicros) * absorbed;
    return this.#rawMicros() + BigInt(Math.round(this.#offsetMicros));
  }

  #rawMicros(): bigint {
    const sinceAnchorMs = this.#perfNow() - this.#anchorPerfMs;
    return this.#anchorServerMicros + BigInt(Math.round(sinceAnchorMs * 1000));
  }
}
