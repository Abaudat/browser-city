// Reads `net.*`'s balance keys and `defs/`'s generated
// `positionUnitsPerCell` into a `PositionConfig` exactly once -- the sender
// period and the interpolation delay both derive from the one dial
// (`net.player_position_hz`); no second rate literal exists anywhere.

import type { Defs } from "../defs/types";
import { remoteDelayMs } from "./remote-motion";

const MS_PER_S = 1000;

export interface PositionConfig {
  /** `net.player_position_hz`. */
  readonly hz: number;
  /** The sender's period: `1000 / hz`. */
  readonly periodMs: number;
  /** The interpolation delay, at least two periods. */
  readonly delayMs: number;
  readonly unitsPerCell: number;
}

function getBalance(defs: Defs, key: string): number {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`loadPositionConfig: no balance entry for '${key}'`);
  return entry.value;
}

export function loadPositionConfig(defs: Defs): PositionConfig {
  const hz = getBalance(defs, "net.player_position_hz");
  const periodMs = MS_PER_S / hz;
  return {
    hz,
    periodMs,
    delayMs: remoteDelayMs(periodMs, getBalance(defs, "net.player_interpolation_delay_ms")),
    unitsPerCell: defs.positionUnitsPerCell,
  };
}
