// Story 7.1 (FR145, FR138): where the scene starts. The server writes a
// character's first `player_position` inside its flat when the character is
// created; the position sender's first send would overwrite that row with
// whatever the scene started at. So the scene starts at the stored row when
// one exists (a new tenant's spawn, or a return visit -- never re-homed),
// the sender does not run before the scene has mounted, and a row that only
// arrives after the scene mounted somewhere else, before the sender has run,
// is never overwritten (later rows are the sender's own echo).
// Pure: no DOM, no `net/`.

import { dequantise, type WirePosition } from "./position-codec";

export interface Start {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

export interface ArrivalPosition {
  /** The caller's stored row arrived (or changed). */
  stored(row: WirePosition): void;
  /** The scene is mounting: the position it starts at. */
  mount(): Start;
  /** Whether the position sender may run. */
  senderMayRun(): boolean;
}

export function createArrivalPosition(unitsPerCell: number, fallback: Start): ArrivalPosition {
  let row: WirePosition | undefined;
  let mounted = false;
  let mountedFromRow = false;
  let lateRow = false;
  let ran = false;
  return {
    stored: (r) => {
      if (mounted && !mountedFromRow && !ran) lateRow = true;
      row = r;
    },
    mount: () => {
      mounted = true;
      mountedFromRow = row !== undefined;
      return row ? dequantise(row, unitsPerCell) : fallback;
    },
    senderMayRun: () => {
      const may = mounted && !lateRow;
      if (may) ran = true;
      return may;
    },
  };
}
