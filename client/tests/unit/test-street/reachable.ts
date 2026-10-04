// The cells a walker can reach on foot, over the real grid and the real
// transitions: one shared helper for the reachability test and the committed
// golden (`regen-golden.ts`). The bounds are the fixture's own.
import {
  PLAYER_START,
  STREET_TRANSITIONS,
  streetPlacedRows,
} from "../../../src/test-street/fixture";
import { cellOf } from "../../../src/world/ownership";
import { TransitionIndex, type TransitionSpec } from "../../../src/world/transitions";
import type { WorldIndex } from "../../../src/world/world-index";
import {
  isBodyClear,
  isCellStandable,
  streetMovementConfig,
  streetObjectSources,
  streetWorldIndex,
} from "./street-world";

export const cellKey = (floor: number, x: number, y: number) => `${floor}|${x}|${y}`;

/** The fixture's extent in whole cells: the far edge of everything placed,
 * footprints and the ring included, plus a cell. Never a hand-typed size. */
export function fixtureExtent(): { readonly widthCells: number; readonly heightCells: number } {
  const sources = streetObjectSources();
  let widthCells = 0;
  let heightCells = 0;
  for (const row of streetPlacedRows()) {
    const source = sources.get(row.defId);
    widthCells = Math.max(widthCells, row.x + (source?.width ?? 1) + 1);
    heightCells = Math.max(heightCells, row.y + 2);
  }
  return { widthCells, heightCells };
}

/** The floors the fixture's transitions join, lowest first. */
export function fixtureFloors(specs: readonly TransitionSpec[] = STREET_TRANSITIONS): number[] {
  return [...new Set(specs.flatMap((t) => [t.floor, t.targetFloor]))].sort((a, b) => a - b);
}

/** Every cell a body can reach on foot from `start`, crossing transitions: a
 * flood over the body's own sub-cell positions (a one-cell step is the least
 * a walker can make), so a gap only a body edge can use counts. `crossed` is
 * the anchors a step walked into. */
export function reachableCells(
  world: WorldIndex = streetWorldIndex(),
  specs: readonly TransitionSpec[] = STREET_TRANSITIONS,
  start: { x: number; y: number; floor: number } = PLAYER_START,
) {
  const config = streetMovementConfig();
  const sub = config.subcellsPerCell;
  const index = new TransitionIndex(specs, {
    isStandable: (x, y, floor) => isCellStandable(world, config, x, y, floor),
  });
  const floors = fixtureFloors();
  const lowest = floors[0] ?? 0;
  const { widthCells, heightCells } = fixtureExtent();
  const maxX = widthCells * sub;
  const maxY = heightCells * sub;
  const visited = new Uint8Array(floors.length * maxX * maxY);
  const at = (floor: number, cx: number, feet: number) =>
    ((floor - lowest) * maxY + feet) * maxX + cx;
  const seen = new Set<string>();
  const crossed = new Set<string>();
  const queue: number[] = [];
  const push = (floor: number, cx: number, feet: number) => {
    const i = at(floor, cx, feet);
    if (visited[i]) return;
    visited[i] = 1;
    queue.push(floor, cx, feet);
    seen.add(cellKey(floor, cellOf(cx / sub), cellOf(feet / sub)));
  };
  push(start.floor, Math.round(start.x * sub), Math.round(start.y * sub));
  for (let head = 0; head < queue.length; head += 3) {
    const floor = queue[head] as number;
    const cx = queue[head + 1] as number;
    const feet = queue[head + 2] as number;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = feet + dy;
      if (nx < 0 || ny < 0 || nx >= maxX || ny >= maxY) continue;
      if (!isBodyClear(world, config, floor, nx, ny)) continue;
      const cellX = cellOf(nx / sub);
      const cellY = cellOf(ny / sub);
      const changed = cellX !== cellOf(cx / sub) || cellY !== cellOf(feet / sub);
      const landing = changed ? index.transitionAt(cellX, cellY, floor) : undefined;
      if (!landing) {
        push(floor, nx, ny);
        continue;
      }
      crossed.add(cellKey(floor, cellX, cellY));
      if (landing.x === cellX && landing.y === cellY) {
        // A transition onto its own cell keeps the walker's position.
        if (isBodyClear(world, config, landing.floor, nx, ny)) push(landing.floor, nx, ny);
      } else {
        push(
          landing.floor,
          Math.round((landing.x + 0.5) * sub),
          Math.round((landing.y + 0.5) * sub),
        );
      }
    }
  }
  return { seen, crossed };
}

/** The reachable cells as one picture per floor, a row of `#` (reachable) and
 * `.` (not) per cell row: what the golden holds, so a layout change that moves
 * reachability is a visible diff. */
export function reachableGrid(
  seen: ReadonlySet<string> = reachableCells().seen,
): Record<string, string[]> {
  const { widthCells, heightCells } = fixtureExtent();
  const grid: Record<string, string[]> = {};
  for (const floor of fixtureFloors()) {
    grid[String(floor)] = Array.from({ length: heightCells }, (_, y) =>
      Array.from({ length: widthCells }, (_, x) =>
        seen.has(cellKey(floor, x, y)) ? "#" : ".",
      ).join(""),
    );
  }
  return grid;
}
