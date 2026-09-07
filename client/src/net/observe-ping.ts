// The one seam where an SDK row becomes client state (Quentin, story 1.1).
// Pure, no socket, unit-tested under Vitest with a fabricated row -- this
// is where any later `demo_ping`-shaped behaviour goes, not in connection.ts.

export interface PingRow {
  readonly id: bigint;
  readonly message: string;
}

export interface PingObservation {
  readonly id: bigint;
  readonly message: string;
  readonly observedAtMs: number;
}

/**
 * Turns a `demo_ping` row insert into client state, stamped with the wall
 * clock time it was observed. `now` is injectable so the pure transform
 * stays testable without patching the global clock.
 */
export function observePingInsert(row: PingRow, now: () => number = Date.now): PingObservation {
  return {
    id: row.id,
    message: row.message,
    observedAtMs: now(),
  };
}
