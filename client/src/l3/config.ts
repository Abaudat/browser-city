// The L3 dials, read from the generated defs once. `defs/types` is plain
// data, so importing it does not widen `l3/**`'s import ban.

import type { Defs, Family } from "../defs/types";
import type { FlavourRow } from "./flavour";

const MILLICELLS_PER_CELL = 1000;
const PERCENT = 100;

export interface L3Config {
  /** `movement.walk_speed_millicells_per_s` x `routing.speed_percent.walk`. */
  readonly walkCellsPerS: number;
  readonly paceBandPercent: number;
  readonly stallBoundMs: number;
  readonly earlyArrivalBoundMilliminutes: number;
  readonly marginCells: number;
  readonly nodeBudget: number;
  readonly maxCells: number;
  /** Ground distance of one walk cycle, in cells. */
  readonly strideCells: number;
  readonly realMsPerCityMinute: number;
  /** Walkers ease round another body from this far out, in cells. */
  readonly avoidRadiusCells: number;
  /** The gap two bodies keep at closest approach, in cells. */
  readonly avoidClearanceCells: number;
  /** A sidestep eases in over this distance from either end of an edge. */
  readonly avoidRampCells: number;
  /** Lines closer than this are one line, in cells. */
  readonly avoidTieBandCells: number;
  readonly avoidMaxNeighbours: number;
  /** Half the width of a body, in cells: the sidestep keeps this clear of walls. */
  readonly bodyHalfWidthCells: number;
  readonly flavourBucketMilliminutes: number;
  /** The flavour catalogue: every row a standing citizen may show. */
  readonly flavourRows: readonly FlavourRow[];
  readonly idleFrameMilliminutes: number;
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
    marginCells: balance(defs, "l3.path_box_margin_cells"),
    nodeBudget: balance(defs, "l3.path_node_budget"),
    maxCells: balance(defs, "l3.path_max_cells"),
    strideCells: balance(defs, "movement.gait_stride_millicells_per_cycle") / MILLICELLS_PER_CELL,
    realMsPerCityMinute: defs.realMsPerCityMinute,
    avoidRadiusCells: balance(defs, "l3.avoid_radius_millicells") / MILLICELLS_PER_CELL,
    avoidClearanceCells: balance(defs, "l3.avoid_clearance_millicells") / MILLICELLS_PER_CELL,
    avoidRampCells: balance(defs, "l3.avoid_ramp_millicells") / MILLICELLS_PER_CELL,
    avoidTieBandCells: balance(defs, "l3.avoid_tie_band_millicells") / MILLICELLS_PER_CELL,
    avoidMaxNeighbours: balance(defs, "l3.avoid_max_neighbours"),
    bodyHalfWidthCells:
      balance(defs, "movement.player_body_width_subcells") / defs.colliderSubcellsPerCell / 2,
    flavourBucketMilliminutes: balance(defs, "l3.flavour_bucket_milliminutes"),
    flavourRows: [
      {
        id: "glance",
        weightPercent: balance(defs, "l3.flavour_glance_percent"),
        durationMilliminutes: balance(defs, "l3.flavour_glance_milliminutes"),
        animation: "idle",
        facing: "away",
      },
    ],
    idleFrameMilliminutes: balance(defs, "l3.idle_frame_milliminutes"),
  };
}

/** The micro-path search dials of a config. */
export function pathConfigOf(config: L3Config): {
  readonly marginCells: number;
  readonly nodeBudget: number;
  readonly maxCells: number;
} {
  return {
    marginCells: config.marginCells,
    nodeBudget: config.nodeBudget,
    maxCells: config.maxCells,
  };
}

/** The frames in one direction of the walk row for `family`, from the
 * appearance layout -- the one place that number lives. */
export function walkFramesPerCycle(defs: Defs, family: Family): number {
  const layout = defs.appearanceLayouts.find((l) => l.family === family);
  const row = layout?.rows.find((r) => r.animation === "walk");
  if (!row) throw new Error(`walkFramesPerCycle: no walk row in the ${family} appearance layout`);
  return row.framesPerDirection;
}

/** The frames in one direction of every animation `family`'s layout has, keyed
 * by animation: what a flavour row needs to be eligible. */
export function framesByAnimation(defs: Defs, family: Family): Record<string, number> {
  const layout = defs.appearanceLayouts.find((l) => l.family === family);
  const out: Record<string, number> = {};
  for (const row of layout?.rows ?? []) out[row.animation] = row.framesPerDirection;
  return out;
}
