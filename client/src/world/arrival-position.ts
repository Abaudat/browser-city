// Story 7.1 (FR145, FR138): where the scene starts. The server writes a
// character's first `player_position` inside its flat when the character is
// created; the position sender's first send would overwrite that row with
// whatever the scene started at. So the scene starts at the stored row when
// one exists (a return visit -- never re-homed). A new player's scene mounts
// behind the name prompt, before `create_character` has run: the row that
// arrives after it, before the sender has ever run, is the arrival, and the
// scene is moved to it. Once the sender has run, later rows are its own
// echo and move nothing.
// Pure: no DOM, no `net/`.

import { dequantise, type WirePosition } from "./position-codec";

export interface Start {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

export interface ArrivalPosition {
  /** The caller's stored row arrived (or changed). Returns where the scene
   * is to be moved when this row is the arrival of a scene that started on
   * the fallback and whose sender has not yet run; otherwise nothing. */
  stored(row: WirePosition): Start | undefined;
  /** The scene is mounting: the position it starts at. */
  mount(): Start;
  /** Whether the position sender may run. */
  senderMayRun(): boolean;
}

export function createArrivalPosition(unitsPerCell: number, fallback: Start): ArrivalPosition {
  let row: WirePosition | undefined;
  let mounted = false;
  let adopted = false;
  let ran = false;
  return {
    stored: (r) => {
      row = r;
      if (!mounted || adopted || ran) return undefined;
      adopted = true;
      return dequantise(r, unitsPerCell);
    },
    mount: () => {
      mounted = true;
      adopted = row !== undefined;
      return row ? dequantise(row, unitsPerCell) : fallback;
    },
    senderMayRun: () => {
      if (mounted) ran = true;
      return mounted;
    },
  };
}
