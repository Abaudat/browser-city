// A `player_position` row as plain data (story 4.4): the frame path never
// sees a `bigint` or a `Timestamp`. `tMs` is the server's `updated_at` in
// milliseconds, a plain number.

import type { PlayerPosition } from "./bindings/types";

export interface PlayerPositionRow {
  readonly characterId: string;
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly fracX: number;
  readonly fracY: number;
}

const MICROS_PER_MS = 1000n;

export function plainPlayerRow(row: PlayerPosition): PlayerPositionRow {
  return {
    characterId: String(row.characterId),
    // Microseconds since the epoch fit a double exactly for any real date.
    tMs: Number(row.updatedAt.microsSinceUnixEpoch / MICROS_PER_MS),
    x: row.x,
    y: row.y,
    floor: row.floor,
    fracX: row.fracX,
    fracY: row.fracY,
  };
}
