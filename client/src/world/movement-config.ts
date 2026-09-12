// Reads `movement.*`'s balance keys and `defs/`'s generated
// `COLLIDER_SUBCELLS_PER_CELL` into a `MovementConfig` exactly once (Tim's
// direction) -- every other `world/` module takes the resulting constant,
// never the raw `Defs` document. `defs/types` is plain data (no PixiJS,
// DOM or network), so importing it here does not touch `world/**`'s
// import ban.

import type { Defs } from "../defs/types";
import type { MovementConfig } from "./movement";

const MILLICELLS_PER_CELL = 1000;
const MS_PER_S = 1000;

function getBalance(defs: Defs, key: string): number {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`loadMovementConfig: no balance entry for '${key}'`);
  return entry.value;
}

/** Builds the one `MovementConfig` a scene reads for every `step` call
 * afterwards -- never re-read from `defs` per frame. */
export function loadMovementConfig(defs: Defs): MovementConfig {
  const walkSpeedMillicellsPerS = getBalance(defs, "movement.walk_speed_millicells_per_s");
  return {
    walkSpeedCellsPerMs: walkSpeedMillicellsPerS / MILLICELLS_PER_CELL / MS_PER_S,
    bodyWidthSubcells: getBalance(defs, "movement.player_body_width_subcells"),
    bodyHeightSubcells: getBalance(defs, "movement.player_body_height_subcells"),
    subcellsPerCell: defs.colliderSubcellsPerCell,
  };
}
