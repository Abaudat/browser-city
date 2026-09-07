// The one seam where an SDK row becomes client state (Quentin, story 1.1).
// Pure, no socket, unit-tested under Vitest with a fabricated row -- this
// is where any later `demo_ping`-shaped behaviour goes, not in connection.ts.
import type { Timestamp } from "spacetimedb";

export interface PingRow {
  readonly id: bigint;
  readonly message: string;
  readonly writtenAt: Timestamp;
}

export interface PingObservation {
  readonly id: bigint;
  readonly message: string;
  // Server-stamped (`ctx.timestamp` in `send_ping`), not a wall-clock read
  // taken by whatever issued the write -- the e2e spec's one-second budget
  // is `observedAtMs - writtenAtMs`, and this is what keeps that
  // measurement immune to a CLI process's own startup time.
  readonly writtenAtMs: number;
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
    writtenAtMs: Number(row.writtenAt.toMillis()),
    observedAtMs: now(),
  };
}
