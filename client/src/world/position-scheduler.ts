// When a position is sent (story 4.4, FR138). Pure: the caller hands it the
// latest wire position and a monotonic clock reading, as often as it likes
// (a frame, a timer); it sends only what the dial allows. At most one send
// per period; nothing while the position equals the last one sent; and a
// position that changed is always sent once the period has passed, so the
// rest position is the last row written. It never queues -- only the latest
// position matters.

import type { WirePosition } from "./position-codec";

export interface PositionScheduler {
  /** Offers the current position at `nowMs`; returns whether it was sent. */
  tick(nowMs: number, position: WirePosition): boolean;
}

function same(a: WirePosition, b: WirePosition): boolean {
  return (
    a.x === b.x && a.y === b.y && a.floor === b.floor && a.fracX === b.fracX && a.fracY === b.fracY
  );
}

export function createPositionScheduler(
  periodMs: number,
  send: (position: WirePosition) => void,
): PositionScheduler {
  let lastSent: WirePosition | undefined;
  let lastSentAtMs = Number.NEGATIVE_INFINITY;
  return {
    tick(nowMs, position) {
      if (lastSent && same(lastSent, position)) return false;
      if (nowMs - lastSentAtMs < periodMs) return false;
      lastSent = position;
      lastSentAtMs = nowMs;
      send(position);
      return true;
    },
  };
}
