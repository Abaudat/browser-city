// Story 4.26 (FR117, FR128): the fixture block's arrival flat reaches the
// street. From `HOME_FLAT_SPAWN` the walker reaches every arrival destination,
// never stands off drawn ground (the ring is closed), leaves no drawn standable
// cell landlocked, and no floor-0 collider lies under the cover of the deck,
// its flight or the abutment.

import { describe, expect, it } from "vitest";
import { footprintCells } from "../../../src/world/footprint";
import { isBodyClear, isCellStandable } from "../../../src/world/standable";
import { WorldIndex } from "../../../src/world/world-index";
import {
  ARRIVAL_DESTINATIONS,
  BRIDGE_DECK_DEF_ID,
  BRIDGE_DECK_Y,
  BRIDGE_FLIGHT_X0,
  BRIDGE_STAIRS_ABUTMENT_DEF_ID,
  BRIDGE_STAIRS_ABUTMENT_FOOT_DEF_ID,
  BRIDGE_STAIRS_DECK_DEF_ID,
  BRIDGE_STAIRS_STREET_DEF_ID,
  BRIDGE_UNDER_PILLAR_X,
  BRIDGE_X0,
  BRIDGE_X1,
  HOME_FLAT_SPAWN,
  PLAYER_START,
  STREET_FLOOR,
  STREET_GROUND_TILES,
  streetPlacedRows,
} from "../../fixture-block/fixture";
import { cellKey, reachableCells } from "./reachable";
import { streetMovementConfig, streetObjectSources, streetWorldIndex } from "./street-world";

const config = streetMovementConfig();
const sub = config.subcellsPerCell;
const sources = streetObjectSources();
const allRows = streetPlacedRows();
const world = streetWorldIndex();

function _worldOf(rows: ReturnType<typeof streetPlacedRows>) {
  const built = new WorldIndex(sub, sources);
  for (const row of rows) built.insert(row);
  return built;
}

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
        row.defId === BRIDGE_STAIRS_ABUTMENT_DEF_ID ||
        row.defId === BRIDGE_STAIRS_ABUTMENT_FOOT_DEF_ID;
      const source = sources.get(row.defId);
      if (covers && source) cells.push(...footprintCells(row.x, row.y, source));
    }
    return cells;
  };
  /** Floor-0 colliders under that cover: the support pillar (a real post that
   * holds the deck up) and the up-anchor's north face are the only ones allowed. */
  const PILLAR_ID = 118n;
  const FACE_ID = allRows.find((r) => r.defId === BRIDGE_STAIRS_ABUTMENT_FOOT_DEF_ID)?.objectId;
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
