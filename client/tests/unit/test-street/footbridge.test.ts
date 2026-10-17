// Story 15.19 (FR117, FR126, FR182): the footbridge's flight, on the real
// collision grid and the real resolver. One step at a time on the flight
// (FR117), and every cell of the street and the deck still reachable
// (the re-lay closed nothing but the cells it covers).

import { describe, expect, it } from "vitest";
import {
  ARRIVAL_DESTINATIONS,
  BRIDGE_DECK_DEF_ID,
  BRIDGE_DECK_Y,
  BRIDGE_FLIGHT_X0,
  BRIDGE_FLOOR,
  BRIDGE_STAIRS_ABUTMENT_DEF_ID,
  BRIDGE_STAIRS_DECK_DEF_ID,
  BRIDGE_STAIRS_STREET_DEF_ID,
  BRIDGE_UNDER_PILLAR_X,
  BRIDGE_X0,
  BRIDGE_X1,
  HOME_FLAT_SPAWN,
  PLAYER_START,
  STREET_FLOOR,
  STREET_GROUND_TILES,
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
import {
  committedDefs,
  streetFlightIndex,
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
            const next = step({ x, y }, dir, 16, world, row.floor, config, 1);
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
              streetFlightIndex(),
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

// --- the arrival flat reaches the street (story 4.26) -----------------------

describe("a real player's start reaches every destination on foot (FR117, FR128)", () => {
  const fromFlat = reachableCells(world, undefined, HOME_FLAT_SPAWN);

  it("the flat reaches every arrival destination: it stands in a `stand` cell and enters a `descend` anchor", () => {
    const unreachable = ARRIVAL_DESTINATIONS.filter(
      (d) =>
        !(d.arrive === "descend" ? fromFlat.crossed : fromFlat.seen).has(
          cellKey(STREET_FLOOR, d.x, d.y),
        ),
    ).map((d) => `${d.name} (${d.x}, ${d.y})`);
    expect(unreachable, `HOME_FLAT_SPAWN cannot reach: ${unreachable.join("; ")}`).toEqual([]);
  });

  /** The cells the world draws something walkable on, per floor: the ground
   * passes, and the staircase's and deck's own footprints. */
  const drawnGround = (floor: number): Set<string> => {
    const cells = new Set<string>();
    for (const t of STREET_GROUND_TILES) {
      if (t.floor !== floor) continue;
      for (let y = t.y0; y < t.y1; y++)
        for (let x = t.x0; x < t.x1; x++) cells.add(cellKey(floor, x, y));
    }
    const walked = [BRIDGE_DECK_DEF_ID, BRIDGE_STAIRS_STREET_DEF_ID, BRIDGE_STAIRS_DECK_DEF_ID];
    for (const row of allRows) {
      const source = sources.get(row.defId);
      if (row.floor !== floor || !walked.includes(row.defId) || !source) continue;
      for (const c of footprintCells(row.x, row.y, source)) cells.add(cellKey(floor, c.x, c.y));
    }
    return cells;
  };

  it("a walker from the flat never stands off drawn ground, on any floor: the ring is closed", () => {
    const off: string[] = [];
    for (const key of fromFlat.standing) {
      const floor = Number(key.split("|")[0]);
      if (!drawnGround(floor).has(key)) off.push(key);
    }
    expect(
      off.sort(),
      "floor|x|y of every cell a walker can stand in with no ground drawn there",
    ).toEqual([]);
  });

  // Drawn floor-0 cells nobody can reach on foot, each with its reason. Empty
  // by default: a sealed pocket is a red test, never an entry here.
  const UNREACHABLE_DRAWN_CELLS: ReadonlyMap<string, string> = new Map();

  it("every drawn, standable floor-0 cell is reached from the flat: no landlocked pocket", () => {
    const pockets: string[] = [];
    for (const key of drawnGround(STREET_FLOOR)) {
      const [, x, y] = key.split("|").map(Number) as [number, number, number];
      if (!isCellStandable(world, config, x, y, STREET_FLOOR)) continue;
      if (fromFlat.standing.has(key) || fromFlat.seen.has(key) || fromFlat.crossed.has(key))
        continue;
      if (UNREACHABLE_DRAWN_CELLS.has(key)) continue;
      pockets.push(`(${x}, ${y})`);
    }
    expect(pockets, `drawn standable cells the flat cannot reach: ${pockets.join(" ")}`).toEqual(
      [],
    );
  });

  it("the street is one connected region whichever start a spec uses", () => {
    const fromShop = reachableCells(world, undefined, PLAYER_START);
    expect([...fromFlat.seen].sort()).toEqual([...fromShop.seen].sort());
  });
});

// --- floor isolation and the open ground under the deck (FR117, FR128) -------

describe("what is solid on one floor never closes the cells under a storey above it (FR117)", () => {
  /** The cells the staircase and the deck are drawn over on the street: the
   * deck and its flight a storey up, and the abutment rows. */
  const coverCells = () => {
    const cells: { x: number; y: number }[] = [];
    for (const row of allRows) {
      const covers =
        (row.floor > STREET_FLOOR &&
          (row.defId === BRIDGE_DECK_DEF_ID || row.defId === BRIDGE_STAIRS_DECK_DEF_ID)) ||
        row.defId === BRIDGE_STAIRS_ABUTMENT_DEF_ID;
      const source = sources.get(row.defId);
      if (covers && source) cells.push(...footprintCells(row.x, row.y, source));
    }
    return cells;
  };
  /** Floor-0 colliders under that cover: the support pillar (a real post that
   * holds the deck up) and the up-anchor's north face are the only ones allowed. */
  const PILLAR_ID = 118n;
  const FACE_ID = 137n;
  /** The ring's north edge (105) runs under the abutment's top row. */
  const RING_EDGE_ID = 105n;
  const collidersUnderCover = (w: WorldIndex) =>
    coverCells().flatMap(({ x, y }) =>
      w
        .entriesInCell(STREET_FLOOR, x, y)
        .filter(
          (e) => e.objectId !== PILLAR_ID && e.objectId !== FACE_ID && e.objectId !== RING_EDGE_ID,
        )
        .map((e) => `object ${e.objectId} closes (${x}, ${y}) on floor ${STREET_FLOOR}`),
    );

  it("no floor-0 collider lies under the cover of the deck, its flight or the abutment (bar the pillar and the up-anchor's face)", () => {
    expect(coverCells().length).toBeGreaterThan(0);
    expect(collidersUnderCover(world)).toEqual([]);
  });

  it("the rule catches the whole-cell collider the abutment used to carry", () => {
    const abutment = sources.get(BRIDGE_STAIRS_ABUTMENT_DEF_ID);
    if (!abutment) throw new Error("no abutment source");
    const withOldCollider = new Map(sources);
    withOldCollider.set(BRIDGE_STAIRS_ABUTMENT_DEF_ID, {
      ...abutment,
      collider: { x0: 0, y0: 0, x1: 32, y1: 16 },
    });
    const old = new WorldIndex(sub, withOldCollider);
    for (const row of allRows) old.insert(row);
    const found = collidersUnderCover(old);
    expect(found.length).toBeGreaterThan(0);
  });

  // The street under the deck: row 6 of the flight's columns, and the deck row.
  const underDeck: { x: number; y: number }[] = [];
  // (The pillar is a real post, a bollard.)
  for (let x = BRIDGE_X0; x <= BRIDGE_X1; x++) {
    if (x !== BRIDGE_UNDER_PILLAR_X) underDeck.push({ x, y: BRIDGE_DECK_Y });
  }
  for (let x = BRIDGE_FLIGHT_X0; x <= BRIDGE_X1; x++) underDeck.push({ x, y: BRIDGE_DECK_Y - 1 });

  it("the open ground under the deck is standable on floor 0 for the player's real body", () => {
    for (const { x, y } of underDeck) {
      expect(isCellStandable(world, config, x, y, STREET_FLOOR), `cell (${x}, ${y})`).toBe(true);
      expect(
        isBodyClear(world, config, STREET_FLOOR, (x + 0.5) * sub, (y + 0.5) * sub),
        `body at the centre of (${x}, ${y})`,
      ).toBe(true);
    }
  });

  it("the only floor-0 collider north of the flight's up-anchor is a thin face on the deck row's south edge", () => {
    const faceTop = BRIDGE_DECK_Y * sub + 14;
    for (let x = BRIDGE_FLIGHT_X0; x <= BRIDGE_X1; x++) {
      const centre = (x + 0.5) * sub;
      expect(isBodyClear(world, config, STREET_FLOOR, centre, faceTop), `(${x}) at the face`).toBe(
        true,
      );
      expect(
        isBodyClear(world, config, STREET_FLOOR, centre, faceTop + 1),
        `(${x}) over the face`,
      ).toBe(false);
    }
    // A walker on the deck row cannot step south onto the flight.
    const from = { x: (BRIDGE_FLIGHT_X0 + 1) * sub, y: faceTop };
    expect(isBodyClear(world, config, STREET_FLOOR, from.x, from.y + 1)).toBe(false);
  });
});
