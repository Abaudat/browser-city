// Whole-milliminute arithmetic for building legs. Instants are integers.

/** The whole milliminutes (at least one) that `ms` real milliseconds span. */
export function milliminutesFor(ms: number, msPerMilliminute: number): number {
  return Math.max(1, Math.round(ms / msPerMilliminute));
}

/** Which whole period of length `period` the instant `t` falls in. */
export function periodOf(t: number, period: number): number {
  return Math.floor(t / period);
}
