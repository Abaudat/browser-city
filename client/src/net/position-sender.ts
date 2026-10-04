// The one caller of the position reducer (story 4.4, FR138; NFR32). A timer
// -- injected, never the render ticker -- reads the player's latest position
// and offers it to the pure scheduler, which sends at most once per period,
// nothing while the player stands still, and always the rest position.

import { quantise, type WirePosition } from "../world/position-codec";
import { createPositionScheduler } from "../world/position-scheduler";

export interface PositionSenderOptions {
  /** Read at each send, so a reconnect is a different connection. */
  readonly conn: () => {
    readonly reducers: { setPlayerPosition(position: WirePosition): Promise<void> };
  };
  /** The player's current position in cells, or none before the scene has one. */
  readonly position: () => { x: number; y: number; floor: number } | undefined;
  readonly periodMs: number;
  readonly unitsPerCell: number;
  readonly now?: () => number;
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

export interface PositionSender {
  /** Final: no call is made after it, even from a tick already queued. A
   * call on a connection that is not live would be queued by the SDK, one
   * per period, without bound. */
  stop(): void;
}

export function startPositionSender(options: PositionSenderOptions): PositionSender {
  const { conn, position, periodMs, unitsPerCell } = options;
  const now = options.now ?? (() => performance.now());
  const setTimer = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer =
    options.clearInterval ?? ((h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>));

  let stopped = false;
  const scheduler = createPositionScheduler(periodMs, (p: WirePosition) => {
    conn()
      .reducers.setPlayerPosition(p)
      .catch((error: unknown) => {
        console.error("[net] position write refused", error);
      });
  });

  // Polling at half the period keeps timer jitter from costing a whole
  // period; the scheduler, not the timer, decides what is sent.
  const handle = setTimer(() => {
    if (stopped) return;
    const p = position();
    if (p) scheduler.tick(now(), quantise(p.x, p.y, p.floor, unitsPerCell));
  }, periodMs / 2);

  return {
    stop: () => {
      stopped = true;
      clearTimer(handle);
    },
  };
}
