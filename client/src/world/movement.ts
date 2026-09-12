// The client-authoritative movement step (FR137): input direction, speed
// and body size in, a new position out, resolved against the derived
// `CollisionGrid` by per-axis swept AABB. No network, no PixiJS, no DOM --
// `world/**`'s import ban (`client/biome.json`) makes that structural.

import type { CollisionGridQuery, GridEntry } from "./collision-grid";
import { cellsForRange } from "./subcells";

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** The three balance-key-derived constants this module reads exactly once
 * (Tim's direction) -- never a literal scattered through movement code. */
export interface MovementConfig {
  /** Derived from `movement.walk_speed_millicells_per_s`: cells travelled
   * per millisecond in open space. */
  readonly walkSpeedCellsPerMs: number;
  /** `movement.player_body_width_subcells`. */
  readonly bodyWidthSubcells: number;
  /** `movement.player_body_height_subcells`. */
  readonly bodyHeightSubcells: number;
  /** `defs/`'s generated `COLLIDER_SUBCELLS_PER_CELL` -- the same unit a
   * `collider` rect and this grid's own entries are declared in. */
  readonly subcellsPerCell: number;
}

/** A single scheduled-reducer-timing-style clamp (`docs/architecture.md`):
 * a backgrounded tab's huge next frame delta must never turn into a
 * teleport through a wall. */
const MAX_DELTA_MS = 100;

function candidatesInRange(
  grid: CollisionGridQuery,
  floor: number,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  subcellsPerCell: number,
): readonly GridEntry[] {
  const [cellX0, cellX1] = cellsForRange(xMin, xMax, subcellsPerCell);
  const [cellY0, cellY1] = cellsForRange(yMin, yMax, subcellsPerCell);
  const seen = new Map<bigint, GridEntry>();
  for (let cy = cellY0; cy <= cellY1; cy++) {
    for (let cx = cellX0; cx <= cellX1; cx++) {
      for (const entry of grid.entriesInCell(floor, cx, cy)) {
        seen.set(entry.objectId, entry);
      }
    }
  }
  return [...seen.values()];
}

/**
 * Resolves movement along one axis, holding the perpendicular axis fixed
 * at the body's current `[otherMin, otherMax)` range -- per-axis swept
 * AABB (Tim's direction): moving X then Y this way is what gives sliding
 * along a surface instead of catching on it, and querying the union of
 * the start and end boxes (never just the end box) is what makes it a
 * sweep, so no delta -- however large -- can tunnel through a collider
 * thinner than one step.
 *
 * `extentBefore`/`extentAfter` place the body relative to the moving
 * coordinate: X is centred (`extentBefore === extentAfter`, half the
 * body's width each way); Y is not (the body's bottom edge *is* the
 * position, so `extentAfter` is 0 and the whole height is `extentBefore`).
 */
function resolveAxis(
  startPos: number,
  desiredPos: number,
  extentBefore: number,
  extentAfter: number,
  otherMin: number,
  otherMax: number,
  axis: "x" | "y",
  grid: CollisionGridQuery,
  floor: number,
  subcellsPerCell: number,
): number {
  if (desiredPos === startPos) return startPos;

  const startMin = startPos - extentBefore;
  const startMax = startPos + extentAfter;
  const desiredMin = desiredPos - extentBefore;
  const desiredMax = desiredPos + extentAfter;
  const unionMin = Math.min(startMin, desiredMin);
  const unionMax = Math.max(startMax, desiredMax);

  const candidates =
    axis === "x"
      ? candidatesInRange(grid, floor, unionMin, otherMin, unionMax, otherMax, subcellsPerCell)
      : candidatesInRange(grid, floor, otherMin, unionMin, otherMax, unionMax, subcellsPerCell);

  const movingPositive = desiredPos > startPos;
  let result = desiredPos;

  for (const candidate of candidates) {
    const rect = candidate.rect;
    const [perpMin, perpMax, faceMin, faceMax] =
      axis === "x" ? [rect.y0, rect.y1, rect.x0, rect.x1] : [rect.x0, rect.x1, rect.y0, rect.y1];

    // Half-open overlap test (touching is not blocked): the perpendicular
    // ranges must actually overlap, not merely touch at a shared edge --
    // this is what keeps two cell-adjacent colliders forming a flush wall
    // from catching the player on their internal seam.
    if (!(otherMin < perpMax && perpMin < otherMax)) continue;

    if (movingPositive) {
      // The leading edge is `pos + extentAfter` (the body's own max
      // bound) -- clamping must hold *that* edge at the collider's near
      // face, not the opposite one.
      if (faceMin >= startMax && faceMin < desiredMax) {
        result = Math.min(result, faceMin - extentAfter);
      }
    } else {
      // The leading edge is `pos - extentBefore` (the body's own min
      // bound) moving in the negative direction.
      if (faceMax <= startMin && faceMax > desiredMin) {
        result = Math.max(result, faceMax + extentBefore);
      }
    }
  }

  return result;
}

/**
 * One movement step (FR137): `inputDir` need not be unit length (a
 * diagonal is normalised here, so diagonal speed never exceeds axis
 * speed); `position` and the return value are continuous world-cell
 * coordinates, the same unit every other `world`/`render` module uses.
 * Resolution happens internally in sub-cell space, where every collider
 * face is an exactly representable integer (Tim's direction) -- the
 * cell<->sub-cell conversion (`* subcellsPerCell`/`/ subcellsPerCell`) is
 * always exact because `subcellsPerCell` is a power of two.
 */
export function step(
  position: Vec2,
  inputDir: Vec2,
  deltaMsRaw: number,
  grid: CollisionGridQuery,
  floor: number,
  config: MovementConfig,
): Vec2 {
  if (inputDir.x === 0 && inputDir.y === 0) return position;

  const deltaMs = Math.min(deltaMsRaw, MAX_DELTA_MS);
  const length = Math.hypot(inputDir.x, inputDir.y);
  const distanceCells = config.walkSpeedCellsPerMs * deltaMs;
  const desiredXCells = position.x + (inputDir.x / length) * distanceCells;
  const desiredYCells = position.y + (inputDir.y / length) * distanceCells;

  const { subcellsPerCell, bodyWidthSubcells, bodyHeightSubcells } = config;
  const halfWidth = bodyWidthSubcells / 2;

  const startXSub = position.x * subcellsPerCell;
  const startYSub = position.y * subcellsPerCell; // the body's bottom edge

  // X pass: the body's Y range stays at its start position throughout.
  const yMin = startYSub - bodyHeightSubcells;
  const yMax = startYSub;
  const desiredXSub = desiredXCells * subcellsPerCell;
  const resolvedXSub = resolveAxis(
    startXSub,
    desiredXSub,
    halfWidth,
    halfWidth,
    yMin,
    yMax,
    "x",
    grid,
    floor,
    subcellsPerCell,
  );

  // Y pass: the body's X range uses the already-resolved X.
  const xMin = resolvedXSub - halfWidth;
  const xMax = resolvedXSub + halfWidth;
  const desiredYSub = desiredYCells * subcellsPerCell;
  const resolvedYSub = resolveAxis(
    startYSub,
    desiredYSub,
    bodyHeightSubcells,
    0,
    xMin,
    xMax,
    "y",
    grid,
    floor,
    subcellsPerCell,
  );

  return {
    x: resolvedXSub / subcellsPerCell,
    y: resolvedYSub / subcellsPerCell,
  };
}
