// The L3 dials, read from the generated defs once. `defs/types` is plain
// data, so importing it does not widen `l3/**`'s import ban.

import type { Defs } from "../defs/types";

const MILLICELLS_PER_CELL = 1000;
const PERCENT = 100;

export interface L3Config {
  /** `movement.walk_speed_millicells_per_s` x `routing.speed_percent.walk`. */
  readonly walkCellsPerS: number;
  readonly paceBandPercent: number;
  readonly stallBoundMs: number;
  readonly earlyArrivalBoundMilliminutes: number;
  readonly facingHoldMs: number;
  readonly marginCells: number;
  readonly nodeBudget: number;
  /** Ground distance of one walk cycle, in cells. */
  readonly strideCells: number;
  readonly realMsPerCityMinute: number;
}

function balance(defs: Defs, key: string): number {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`loadL3Config: no balance entry for '${key}'`);
  return entry.value;
}

export function loadL3Config(defs: Defs): L3Config {
  const speed = balance(defs, "movement.walk_speed_millicells_per_s");
  const walkPercent = balance(defs, "routing.speed_percent.walk");
  return {
    walkCellsPerS: (speed / MILLICELLS_PER_CELL) * (walkPercent / PERCENT),
    paceBandPercent: balance(defs, "l3.walk_pace_band_percent"),
    stallBoundMs: balance(defs, "l3.stall_bound_ms"),
    earlyArrivalBoundMilliminutes: balance(defs, "l3.early_arrival_bound_milliminutes"),
    facingHoldMs: balance(defs, "l3.facing_hold_ms"),
    marginCells: balance(defs, "l3.path_box_margin_cells"),
    nodeBudget: balance(defs, "l3.path_node_budget"),
    strideCells: balance(defs, "movement.gait_stride_millicells_per_cycle") / MILLICELLS_PER_CELL,
    realMsPerCityMinute: defs.realMsPerCityMinute,
  };
}
