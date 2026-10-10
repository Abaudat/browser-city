// Story 15.19 (FR117, FR126, FR182): the footbridge's flight, on the real
// collision grid and the real resolver. One step at a time on the flight
// (FR117), and every cell of the street and the deck still reachable
// (the re-lay closed nothing but the cells it covers).

import { describe, expect, it } from "vitest";
import {
  BRIDGE_DECK_DEF_ID,
  BRIDGE_FLOOR,
  STREET_FLOOR,
  STREET_TRANSITIONS,
  streetPlacedRows,
} from "../../../src/test-street/fixture";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import { footprintCells } from "../../../src/world/footprint";
import { bodyCell, step } from "../../../src/world/movement";
import { isBodyClear, isCellStandable } from "../../../src/world/standable";
import { pairTransitions, TransitionIndex } from "../../../src/world/transitions";
import { WorldIndex } from "../../../src/world/world-index";
import { cellKey, reachableCells, reachableGrid } from "./reachable";
import { REACHABLE_GRID } from "./reachable-golden";
import { committedDefs, streetMovementConfig, streetObjectSources } from "./street-world";

const config = streetMovementConfig();
const sub = config.subcellsPerCell;
const defs = committedDefs();
const sources = streetObjectSources();
const keyOf = (defId: number): string => defs.objects.find((o) => o.id === defId)?.key ?? "";
/** The footbridge's own stair pieces: `bridge_stairs_*` defs. */
const isBridgeStairs = (row: { readonly defId: number }) =>
  keyOf(row.defId).startsWith("bridge_stairs_");

function worldOf(rows: ReturnType<typeof streetPlacedRows>) {
  const built = new WorldIndex(sub, sources);
  for (const row of rows) built.insert(row);
  return built;
}

const allRows = streetPlacedRows();
const world = worldOf(allRows);
const transitions = new TransitionIndex(STREET_TRANSITIONS, {
  isStandable: (x, y, floor) => isCellStandable(world, config, x, y, floor),
  entryBand: {
    subcellsPerCell: sub,
    isBodyClear: (floor, cx, feet) => isBodyClear(world, config, floor, cx, feet),
  },
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
          const here = bodyCell({ x, y });
          if (!cells.some((c) => c.x === here.x && c.y === here.y)) continue;
          positions++;
          for (const dir of [
            { x: 0, y: -1 },
            { x: 0, y: 1 },
            { x: -1, y: 0 },
            { x: 1, y: 0 },
          ]) {
            const next = step({ x, y }, dir, 16, world, row.floor, config);
            const nextCell = bodyCell(next);
            const walkedInto = cellKey(row.floor, nextCell.x, nextCell.y);
            const changedCell = nextCell.x !== here.x || nextCell.y !== here.y;
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

describe("a transition onto its own cell keeps the walker's position (FR117)", () => {
  it("every body position that steps into such an anchor from a clear position is clear on the target floor", () => {
    const sameCell = STREET_TRANSITIONS.filter((t) => t.targetX === t.x && t.targetY === t.y);
    expect(
      sameCell.length,
      "the footbridge's anchors are transitions onto their own cell",
    ).toBeGreaterThan(0);
    let entries = 0;
    for (const t of sameCell) {
      const inCell = (cx: number, feet: number) =>
        Math.floor(cx / sub) === t.x && Math.floor(feet / sub) === t.y;
      for (let cx = t.x * sub; cx < (t.x + 1) * sub; cx++) {
        for (let feet = t.y * sub; feet < (t.y + 1) * sub; feet++) {
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const fromX = cx - dx;
            const fromY = feet - dy;
            if (inCell(fromX, fromY) || !isBodyClear(world, config, t.floor, fromX, fromY))
              continue;
            entries++;
            expect(
              isBodyClear(world, config, t.targetFloor, cx, feet),
              `entering (${t.x}, ${t.y}, floor ${t.floor}) at sub-cell (${cx}, ${feet}) lands in a collider on floor ${t.targetFloor}`,
            ).toBe(true);
          }
        }
      }
    }
    expect(entries, "some position does step into an anchor").toBeGreaterThan(0);
  });

  it("the check is a construction-time refusal: an index whose entry band lands in a collider is refused, naming the cell", () => {
    const spec = [
      { x: 5, y: 5, floor: 0, targetX: 5, targetY: 5, targetFloor: 1 },
      { x: 5, y: 6, floor: 1, targetX: 5, targetY: 6, targetFloor: 0 },
    ];
    const clear = (floor: number, cx: number) => !(floor === 1 && cx < 5 * sub + 4);
    expect(
      () =>
        new TransitionIndex(spec, {
          entryBand: { subcellsPerCell: sub, isBodyClear: (floor, cx) => clear(floor, cx) },
        }),
    ).toThrow(/transition \(5, 5, floor 0\) -> floor 1/);
    expect(
      () =>
        new TransitionIndex(spec, {
          entryBand: { subcellsPerCell: sub, isBodyClear: () => true },
        }),
    ).not.toThrow();
  });
});

// --- reachability ---------------------------------------------------------

describe("the street and the deck stay reachable (FR117)", () => {
  const now = reachableCells(world);

  it("the reachable cells per floor are the committed golden: any layout change that moves them is a diff to review", () => {
    expect(reachableGrid(now.seen)).toEqual(REACHABLE_GRID);
  });

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

  it("the underpass and the cells either side of the deck's west end stay walkable", () => {
    // The deck row on the street, west of the stairs, is still open ground.
    const deckRow = allRows.filter((r) => r.defId === BRIDGE_DECK_DEF_ID);
    const westMost = Math.min(...deckRow.map((r) => r.x));
    const y = deckRow[0]?.y ?? 0;
    expect(now.seen.has(cellKey(STREET_FLOOR, westMost, y))).toBe(true);
    expect(now.seen.has(cellKey(STREET_FLOOR, westMost - 1, y))).toBe(true);
  });
});
