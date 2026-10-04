// Story 15.19 (FR117, FR126, FR182): the footbridge's flight, on the real
// collision grid and the real resolver. One step at a time on the flight
// (FR117), and every cell of the street and the deck still reachable
// (the re-lay closed nothing but the cells it covers).
import { describe, expect, it } from "vitest";
import {
  BRIDGE_DECK_DEF_ID,
  BRIDGE_FLOOR,
  BRIDGE_FOOT_TILES,
  PLAYER_START,
  STREET_FLOOR,
  STREET_GROUND_TILES,
  STREET_TRANSITIONS,
  streetPlacedRows,
} from "../../../src/test-street/fixture";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import { footprintCells } from "../../../src/world/footprint";
import { step } from "../../../src/world/movement";
import { cellOf } from "../../../src/world/ownership";
import {
  pairTransitions,
  TransitionIndex,
  type TransitionSpec,
} from "../../../src/world/transitions";
import { WorldIndex } from "../../../src/world/world-index";
import {
  committedDefs,
  isBodyClear,
  isCellStandable,
  streetMovementConfig,
  streetObjectSources,
} from "./street-world";

const config = streetMovementConfig();
const sub = config.subcellsPerCell;
const defs = committedDefs();
const sources = streetObjectSources();
const keyOf = (defId: number): string => defs.objects.find((o) => o.id === defId)?.key ?? "";
/** The footbridge's own stair pieces: `bridge_stairs_*` defs. */
const isBridgeStairs = (row: { readonly defId: number }) =>
  keyOf(row.defId).startsWith("bridge_stairs_");

const cellKey = (floor: number, x: number, y: number) => `${floor}|${x}|${y}`;

function worldOf(rows: ReturnType<typeof streetPlacedRows>) {
  const built = new WorldIndex(sub, sources);
  for (const row of rows) built.insert(row);
  return built;
}

const allRows = streetPlacedRows();
const world = worldOf(allRows);
const transitions = new TransitionIndex(STREET_TRANSITIONS, {
  isStandable: (x, y, floor) => isCellStandable(world, config, x, y, floor),
});
const anchors = new Set(STREET_TRANSITIONS.map((t) => cellKey(t.floor, t.x, t.y)));

/** The footbridge's pairings: those with an anchor on the deck's floor. */
const bridgePairs = pairTransitions(STREET_TRANSITIONS).pairings.filter(
  (p) => p.forward.floor === BRIDGE_FLOOR || p.reverse.floor === BRIDGE_FLOOR,
);

describe("the footbridge flight on the real grid (FR117)", () => {
  it("is one pair of flights, a pair of transitions per column", () => {
    expect(bridgePairs.length).toBeGreaterThan(0);
    const flightRows = allRows.filter(
      (r) =>
        sources.get(r.defId) !== undefined && defs.objects.find((o) => o.id === r.defId)?.flight,
    );
    const bridgeFlights = flightRows.filter(isBridgeStairs);
    expect(bridgeFlights.map((r) => r.floor).sort()).toEqual([STREET_FLOOR, BRIDGE_FLOOR]);
  });

  it("one step in each of the four directions from any standable position on the flight changes the floor only by entering an explicit transition cell", () => {
    const flightRows = allRows.filter(
      (r) => isBridgeStairs(r) && defs.objects.find((o) => o.id === r.defId)?.flight,
    );
    expect(flightRows.length).toBe(2);
    let positions = 0;
    let entered = 0;
    for (const row of flightRows) {
      const source = sources.get(row.defId);
      if (!source) throw new Error("no source");
      const cells = footprintCells(row.x, row.y, source).filter(
        (c) => !anchors.has(cellKey(row.floor, c.x, c.y)),
      );
      const x0 = Math.min(...cells.map((c) => c.x));
      const y0 = Math.min(...cells.map((c) => c.y));
      const x1 = Math.max(...cells.map((c) => c.x)) + 1;
      const y1 = Math.max(...cells.map((c) => c.y)) + 1;
      for (let cx = x0 * sub; cx <= x1 * sub; cx++) {
        for (let feet = y0 * sub; feet <= y1 * sub; feet++) {
          if (!isBodyClear(world, config, row.floor, cx, feet)) continue;
          const x = cx / sub;
          const y = feet / sub;
          // Only positions whose own cell is a flight cell, never an anchor.
          const here = { x: cellOf(x), y: cellOf(y) };
          if (!cells.some((c) => c.x === here.x && c.y === here.y)) continue;
          positions++;
          for (const dir of [
            { x: 0, y: -1 },
            { x: 0, y: 1 },
            { x: -1, y: 0 },
            { x: 1, y: 0 },
          ]) {
            const next = step({ x, y }, dir, 16, world, row.floor, config);
            const walkedInto = cellKey(row.floor, cellOf(next.x), cellOf(next.y));
            const changedCell = cellOf(next.x) !== here.x || cellOf(next.y) !== here.y;
            const result = stepAndTransition(
              initialFloorWalkState(x, y, row.floor),
              dir,
              16,
              world,
              config,
              transitions,
            );
            const intoAnchor = changedCell && anchors.has(walkedInto);
            if (intoAnchor) entered++;
            expect(
              result.transitioned,
              `from (${x}, ${y}) floor ${row.floor} step ${JSON.stringify(dir)}`,
            ).toBe(intoAnchor);
            expect(result.floor !== row.floor).toBe(intoAnchor);
          }
        }
      }
    }
    expect(positions, "the sweep covered both flights").toBeGreaterThan(0);
    expect(entered, "and some step did enter an anchor").toBeGreaterThan(0);
  });
});

// --- reachability ---------------------------------------------------------

/** Every cell a body can reach on foot from `start`, crossing transitions: a
 * flood over the body's own sub-cell positions on the real grid (a one-cell
 * step is the least a walker can make), so a gap only a body edge can use
 * counts. `crossed` is the anchors a step walked into. */
function flood(
  w: WorldIndex,
  specs: readonly TransitionSpec[],
  start: { x: number; y: number; floor: number },
) {
  const index = new TransitionIndex(specs, {
    isStandable: (x, y, floor) => isCellStandable(w, config, x, y, floor),
  });
  const floors = [...new Set(STREET_TRANSITIONS.flatMap((t) => [t.floor, t.targetFloor]))].sort(
    (a, b) => a - b,
  );
  const lowest = floors[0] ?? 0;
  const maxX = 48 * sub;
  const maxY = 30 * sub;
  const visited = new Uint8Array(floors.length * maxX * maxY);
  const at = (floor: number, cx: number, feet: number) =>
    ((floor - lowest) * maxY + feet) * maxX + cx;
  const cells = new Set<string>();
  const crossed = new Set<string>();
  const queue: number[] = [];
  const push = (floor: number, cx: number, feet: number) => {
    const i = at(floor, cx, feet);
    if (visited[i]) return;
    visited[i] = 1;
    queue.push(floor, cx, feet);
    cells.add(cellKey(floor, Math.floor(cx / sub), Math.floor(feet / sub)));
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
      if (!isBodyClear(w, config, floor, nx, ny)) continue;
      const cellX = Math.floor(nx / sub);
      const cellY = Math.floor(ny / sub);
      const changed = cellX !== Math.floor(cx / sub) || cellY !== Math.floor(feet / sub);
      const landing = changed ? index.transitionAt(cellX, cellY, floor) : undefined;
      if (landing) {
        crossed.add(cellKey(floor, cellX, cellY));
        push(
          landing.floor,
          Math.round((landing.x + 0.5) * sub),
          Math.round((landing.y + 0.5) * sub),
        );
      } else {
        push(floor, nx, ny);
      }
    }
  }
  return { seen: cells, crossed };
}

describe("the street and the deck stay reachable (FR117)", () => {
  const start = { x: PLAYER_START.x, y: PLAYER_START.y, floor: PLAYER_START.floor };
  const now = flood(world, STREET_TRANSITIONS, start);

  it("every standable cell of the deck is reachable, and so is every anchor of the footbridge", () => {
    const deckCells = allRows
      .filter((r) => r.floor === BRIDGE_FLOOR)
      .flatMap((r) => {
        const source = sources.get(r.defId);
        return source && keyOf(r.defId) !== "" ? footprintCells(r.x, r.y, source) : [];
      })
      .filter(
        (c) =>
          isCellStandable(world, config, c.x, c.y, BRIDGE_FLOOR) &&
          !anchors.has(cellKey(BRIDGE_FLOOR, c.x, c.y)),
      );
    expect(allRows.some((r) => r.defId === BRIDGE_DECK_DEF_ID)).toBe(true);
    expect(deckCells.length).toBeGreaterThan(0);
    const missing = deckCells.filter((c) => !now.seen.has(cellKey(BRIDGE_FLOOR, c.x, c.y)));
    expect(missing).toEqual([]);
    // Both the way up and the way down are walked into, from both sides.
    for (const t of STREET_TRANSITIONS) {
      if (t.floor !== BRIDGE_FLOOR && t.targetFloor !== BRIDGE_FLOOR) continue;
      expect(now.crossed.has(cellKey(t.floor, t.x, t.y)), `anchor ${JSON.stringify(t)}`).toBe(true);
    }
  });

  it("every street cell reachable before the footbridge's stairs is still reachable, but the cells they now cover", () => {
    // Master's street: the same fixture with the stairs' own pieces and their
    // transitions left out.
    const without = allRows.filter((r) => !isBridgeStairs(r));
    const before = flood(
      worldOf(without),
      STREET_TRANSITIONS.filter((t) => t.floor !== BRIDGE_FLOOR && t.targetFloor !== BRIDGE_FLOOR),
      start,
    );
    // The difference, stated: the cells the stair pieces cover on the street.
    const covered = new Set(
      allRows
        .filter((r) => isBridgeStairs(r) && r.floor === STREET_FLOOR)
        .flatMap((r) => {
          const source = sources.get(r.defId);
          return source ? footprintCells(r.x, r.y, source) : [];
        })
        .map((c) => cellKey(STREET_FLOOR, c.x, c.y)),
    );
    expect(covered.size).toBeGreaterThan(0);
    // Only the pavement drawn before the stairs: the stairs' own foot is new ground.
    const oldGround = STREET_GROUND_TILES.filter(
      (g) => g.floor === STREET_FLOOR && g !== BRIDGE_FOOT_TILES,
    );
    const onOldGround = (key: string) => {
      const [, x, y] = key.split("|").map(Number);
      return oldGround.some(
        (g) => (x ?? -1) >= g.x0 && (x ?? -1) < g.x1 && (y ?? -1) >= g.y0 && (y ?? -1) < g.y1,
      );
    };
    const lost = [...before.seen].filter(
      (k) =>
        k.startsWith(`${STREET_FLOOR}|`) && onOldGround(k) && !covered.has(k) && !now.seen.has(k),
    );
    expect(lost, "street cells the re-lay cut off").toEqual([]);
  });

  it("the underpass and the cells either side of the deck's west end stay walkable", () => {
    // The deck row on the street, west of the stairs, is still open ground.
    const deckRow = allRows.filter((r) => r.defId === BRIDGE_DECK_DEF_ID);
    const westMost = Math.min(...deckRow.map((r) => r.x));
    const y = deckRow[0]?.y ?? 0;
    expect(now.seen.has(cellKey(STREET_FLOOR, westMost, y))).toBe(true);
    expect(now.seen.has(cellKey(STREET_FLOOR, westMost - 1, y))).toBe(true);
  });
});
