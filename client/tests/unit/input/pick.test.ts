import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Intent } from "../../../src/input/intent";
import type { PickContext, PickPlayer, PickPoint, PickRect } from "../../../src/input/pick";
import { isWithinReach, pickSortKey, resolveClick, topmostAt } from "../../../src/input/pick";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { LAYER_TABLE } from "../../../src/render/layer-table";
import { sortDrawablesInPlace } from "../../../src/render/sort-key";
import { toSortUnits } from "../../../src/render/sort-units";
import type { FootprintEntry, FootprintQuery } from "../../../src/world/footprint-index";

const SUBCELLS = 16;
const TILE = 16;

const RANK_TABLE = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));
const rankOf = (layerCode: number): number => resolveRank(RANK_TABLE, layerCode);
const LAYER_CODES = LAYER_TABLE.filter((row) => !row.deprecated).map((row) => row.code);

const FURNITURE_LAYER = LAYER_TABLE.find((r) => r.name === "furniture")?.code ?? 0;
const OBJECTS_LAYER = LAYER_TABLE.find((r) => r.name === "objects")?.code ?? 0;

/** A `FootprintQuery` over a hand-written cell map -- the pick logic is
 * pure over the interface, so no real index is needed to test it. */
function queryOf(cells: Record<string, FootprintEntry[]>): FootprintQuery {
  return {
    objectsAt(floor, cellX, cellY) {
      return cells[`${floor}:${cellX}:${cellY}`] ?? [];
    },
  };
}

function entry(overrides: Partial<FootprintEntry> & { objectId: bigint }): FootprintEntry {
  return { defId: 1, layer: OBJECTS_LAYER, anchorX: 0, anchorY: 0, ...overrides };
}

const TRASH_BIN_DEF = 1;
const PLAIN_PROP_DEF = 2;
const COUNTER_DEF = 3;

function contextOf(query: FootprintQuery, overrides: Partial<PickContext> = {}): PickContext {
  return {
    index: query,
    objectDefs: new Map([
      // A one-cell bin, reachable from a quarter-cell skirt around it.
      [TRASH_BIN_DEF, { width: 1, height: 1, interactAt: { x0: -4, y0: -4, x1: 20, y1: 20 } }],
      // No interaction declared at all.
      [PLAIN_PROP_DEF, { width: 1, height: 1 }],
      // Three cells wide, reachable only from the row south of it.
      [COUNTER_DEF, { width: 3, height: 1, interactAt: { x0: 0, y0: 16, x1: 48, y1: 32 } }],
    ]),
    rankOf,
    subcellsPerCell: SUBCELLS,
    ...overrides,
  };
}

function player(x: number, y: number, floor = 0): PickPlayer {
  return { x, y, floor };
}

/** A pick point at the centre of a whole cell -- both the cell the broad
 * phase looks up and the world pixel the narrow phase tests. */
function atCell(cellX: number, cellY: number): PickPoint {
  return {
    cellX,
    cellY,
    worldXPx: cellX * TILE + TILE / 2,
    worldYPx: cellY * TILE + TILE / 2,
  };
}

/** The rect a bottom-centre-anchored sprite of `heightPx` covers, for an
 * object anchored on `(cellX, cellY)` and `widthCells` wide -- the same
 * geometry `screenPositionPx` places the sprite with. */
function spriteRect(cellX: number, cellY: number, widthCells: number, heightPx: number): PickRect {
  const bottom = (cellY + 1) * TILE;
  return {
    x0: cellX * TILE,
    y0: bottom - heightPx,
    x1: (cellX + widthCells) * TILE,
    y1: bottom,
  };
}

describe("isWithinReach", () => {
  const def = { width: 1, height: 1, interactAt: { x0: 0, y0: 16, x1: 16, y1: 32 } };
  // The bin is anchored at cell (5, 5), so its reach row is cell (5, 6):
  // sub-cells x in [80, 96), y in [96, 112).
  const anchored = { anchorX: 5, anchorY: 5 };

  it("is true when the player's feet are inside the reach rect", () => {
    expect(isWithinReach(anchored, def, player(5.5, 6.5), 0, SUBCELLS)).toBe(true);
  });

  it("is half-open: the near edge is inside, the far edge is not", () => {
    expect(isWithinReach(anchored, def, player(5.5, 6), 0, SUBCELLS)).toBe(true);
    expect(isWithinReach(anchored, def, player(5.5, 7), 0, SUBCELLS)).toBe(false);
    expect(isWithinReach(anchored, def, player(5, 6.5), 0, SUBCELLS)).toBe(true);
    expect(isWithinReach(anchored, def, player(6, 6.5), 0, SUBCELLS)).toBe(false);
  });

  it("is false just outside the rect on every side", () => {
    expect(isWithinReach(anchored, def, player(4.99, 6.5), 0, SUBCELLS)).toBe(false);
    expect(isWithinReach(anchored, def, player(6.01, 6.5), 0, SUBCELLS)).toBe(false);
    expect(isWithinReach(anchored, def, player(5.5, 5.99), 0, SUBCELLS)).toBe(false);
    expect(isWithinReach(anchored, def, player(5.5, 7.01), 0, SUBCELLS)).toBe(false);
  });

  it("is never reachable across floors, however close in x/y", () => {
    expect(isWithinReach(anchored, def, player(5.5, 6.5, 1), 0, SUBCELLS)).toBe(false);
    expect(isWithinReach(anchored, def, player(5.5, 6.5, -1), 0, SUBCELLS)).toBe(false);
    expect(isWithinReach(anchored, def, player(5.5, 6.5, 0), 0, SUBCELLS)).toBe(true);
  });

  it("a definition that declares no interaction is never reachable", () => {
    expect(isWithinReach(anchored, { width: 1, height: 1 }, player(5.5, 6.5), 0, SUBCELLS)).toBe(
      false,
    );
  });

  it("inv_reach_is_the_declared_rect", () => {
    // The oracle is the reach rect in *continuous* world coordinates,
    // written independently of the implementation's sub-cell arithmetic:
    // the feet are in reach exactly when they are inside the half-open
    // rect the definition declares, translated by the anchor. Anchors,
    // rects (including negative offsets and rects reaching past the
    // footprint), sub-cell counts and both floors are all generated, so
    // swapping a `<` for a `<=` or dropping the anchor translation fails
    // here.
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: -32, max: 0 }),
        fc.integer({ min: -32, max: 0 }),
        fc.integer({ min: 1, max: 48 }),
        fc.integer({ min: 1, max: 48 }),
        fc.constantFrom(4, 8, 16, 32),
        fc.constantFrom(-1, 0, 1),
        fc.constantFrom(-1, 0, 1),
        fc.double({ min: -25, max: 25, noNaN: true }),
        fc.double({ min: -25, max: 25, noNaN: true }),
        (
          anchorX,
          anchorY,
          width,
          height,
          x0,
          y0,
          spanX,
          spanY,
          subcellsPerCell,
          objectFloor,
          playerFloor,
          px,
          py,
        ) => {
          const rect = { x0, y0, x1: x0 + spanX, y1: y0 + spanY };
          const def = { width, height, interactAt: rect };
          const anchor = { anchorX, anchorY };
          const p = player(px, py, playerFloor);

          const actual = isWithinReach(anchor, def, p, objectFloor, subcellsPerCell);

          // Independent model, in whole world-cell units throughout,
          // translated from the footprint's own north-west origin -- the
          // anchor cell itself only when `height === 1`, `height - 1`
          // cells further north otherwise (`world/footprint.ts`'s own
          // convention, restated independently here rather than called).
          const originY = anchorY - (height - 1);
          const feetX = Math.floor(px * subcellsPerCell) / subcellsPerCell;
          const feetY = Math.floor(py * subcellsPerCell) / subcellsPerCell;
          const expected =
            playerFloor === objectFloor &&
            feetX >= anchorX + rect.x0 / subcellsPerCell &&
            feetX < anchorX + rect.x1 / subcellsPerCell &&
            feetY >= originY + rect.y0 / subcellsPerCell &&
            feetY < originY + rect.y1 / subcellsPerCell;

          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 400 },
    );
  });

  // Story 2.2 cycle 1 (Tim's direction): a 3-wide, 2-tall def is the only
  // shape that can tell the footprint's north-west sub-cell origin
  // (`interact_at`'s own local origin) apart from its south-west anchor
  // cell -- a 1-tall def (every case above) reads identically either way.
  it("translates interact_at from the footprint's north-west origin, not the anchor cell, for a multi-row def", () => {
    const def = { width: 3, height: 2, interactAt: { x0: 0, y0: 0, x1: 48, y1: 16 } };
    // Anchor at (10, 5): the footprint's north row is y = 4 (5 - (2-1)).
    // interact_at's own local rect (y 0..16, i.e. sub-cell row 0) is that
    // north row -- world y in [4, 5).
    const anchor = { anchorX: 10, anchorY: 5 };
    expect(isWithinReach(anchor, def, player(10.5, 4.5), 0, SUBCELLS)).toBe(true);
    // Not the anchor's own row (y in [5, 6)) -- that would be the wrong
    // answer under the old (incorrect) top-left-anchor arithmetic.
    expect(isWithinReach(anchor, def, player(10.5, 5.5), 0, SUBCELLS)).toBe(false);
  });
});

describe("pickSortKey", () => {
  // Story 2.2 cycle 1 (Tim's direction): the anchor cell *is* the
  // footprint's own south (bottom-drawn) row (`world/footprint.ts`'s own
  // convention) -- a multi-row def must sort at its anchor's own y, never
  // `anchorY + height - 1`, which would place it one footprint further
  // south than it is actually drawn.
  it("sorts a multi-row entry at its own anchor row, never one footprint further south", () => {
    const tallEntry = entry({ objectId: 1n, defId: TRASH_BIN_DEF, anchorX: 4, anchorY: 6 });
    const key = pickSortKey(tallEntry, 0, contextOf(queryOf({})));
    expect(key.y).toBe(toSortUnits(6));
  });
});

describe("topmostAt", () => {
  it("inv_pick_resolves_topmost_drawn", () => {
    // Any number of objects on one cell, drawn from every real layer in
    // the rank ladder, each independently visible or hidden. The oracle
    // is the renderer's own sort over the visible ones -- the last
    // element is what is drawn on top -- never a restatement of the
    // ordering rule.
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 400 }).map(BigInt), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.array(fc.constantFrom(...LAYER_CODES), { minLength: 8, maxLength: 8 }),
        fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        (ids, layers, visibility) => {
          const candidates = ids.map((objectId, i) =>
            entry({ objectId, layer: layers[i] as number, anchorX: 2, anchorY: 2 }),
          );
          const visible = new Set(
            candidates.filter((_, i) => visibility[i]).map((c) => c.objectId),
          );
          const ctx = contextOf(queryOf({ "0:2:2": candidates }), {
            isVisible: (objectId) => visible.has(objectId),
          });

          const picked = topmostAt(atCell(2, 2), 0, ctx);

          const visibleKeys = candidates
            .filter((c) => visible.has(c.objectId))
            .map((c) => ({
              candidate: c,
              key: pickSortKey(c, 0, ctx),
            }));
          if (visibleKeys.length === 0) {
            expect(picked).toBeUndefined();
            return;
          }
          const keys = visibleKeys.map((k) => k.key);
          sortDrawablesInPlace(keys);
          const front = keys[keys.length - 1];
          const expected = visibleKeys.find((k) => k.key === front)?.candidate;
          expect(picked?.objectId).toBe(expected?.objectId);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("insertion order never decides the winner", () => {
    const front = entry({ objectId: 1n, layer: OBJECTS_LAYER });
    const back = entry({ objectId: 2n, layer: FURNITURE_LAYER });
    expect(
      topmostAt(atCell(0, 0), 0, contextOf(queryOf({ "0:0:0": [front, back] })))?.objectId,
    ).toBe(1n);
    expect(
      topmostAt(atCell(0, 0), 0, contextOf(queryOf({ "0:0:0": [back, front] })))?.objectId,
    ).toBe(1n);
  });

  it("an empty cell resolves to nothing", () => {
    expect(topmostAt(atCell(9, 9), 0, contextOf(queryOf({})))).toBeUndefined();
  });

  it("an object the enclosure rules have hidden can never be picked", () => {
    const hidden = entry({ objectId: 1n, layer: OBJECTS_LAYER });
    const behind = entry({ objectId: 2n, layer: FURNITURE_LAYER });
    const ctx = contextOf(queryOf({ "0:2:2": [hidden, behind] }), {
      isVisible: (objectId) => objectId !== 1n,
    });
    // Not merely "not returned": the retracted wall must not block the
    // click from reaching what is now visible behind it.
    expect(topmostAt(atCell(2, 2), 0, ctx)?.objectId).toBe(2n);
  });
});

describe("picking by what is drawn, not by the footprint cell", () => {
  // Artie's direction: our props are bottom-anchored and draw upward past
  // their own footprint. Clicking the lid of a tall bin, which visually
  // sits over the wall row behind it, must hit the bin.
  const BIN_HEIGHT_PX = 32; // a 16x32 sprite on a 1x1 footprint
  const bin = entry({ objectId: 100n, defId: TRASH_BIN_DEF, anchorX: 5, anchorY: 7 });
  const wall = entry({ objectId: 200n, defId: PLAIN_PROP_DEF, anchorX: 5, anchorY: 6 });

  /** The bin covers its own cell (5, 7) and, through its art overhang,
   * the cell above it (5, 6) -- where the wall also is. */
  const cells = {
    "0:5:7": [bin],
    "0:5:6": [wall, bin],
  };

  const drawnRects = new Map<bigint, PickRect>([
    [100n, spriteRect(5, 7, 1, BIN_HEIGHT_PX)],
    [200n, spriteRect(5, 6, 1, TILE)],
  ]);

  function ctx() {
    return contextOf(queryOf(cells), {
      drawnRectOf: (objectId) => drawnRects.get(objectId),
    });
  }

  it("a click on the tall part of a prop hits that prop, not the wall behind it", () => {
    // The bin's lid: inside cell (5, 6) on screen, but drawn by the bin.
    const lid: PickPoint = {
      cellX: 5,
      cellY: 6,
      worldXPx: 5 * TILE + TILE / 2,
      worldYPx: 6 * TILE + TILE / 2,
    };
    expect(topmostAt(lid, 0, ctx())?.objectId).toBe(100n);
  });

  it("a click in a cell the prop is registered in, but outside its drawn sprite, hits the wall", () => {
    // The broad phase deliberately over-registers: a sideways overhang
    // puts the bin in its neighbour's cells too, and its own row is later
    // than the wall's, so it would win the sort in every one of them.
    // Only the narrow phase stops it -- this is the case that catches a
    // missing rect test.
    const eastWall = entry({ objectId: 300n, defId: PLAIN_PROP_DEF, anchorX: 6, anchorY: 6 });
    const overhangCells = {
      // Both the bin (through its overhang) and the wall really are here.
      "0:6:6": [eastWall, bin],
    };
    const withOverhang = contextOf(queryOf(overhangCells), {
      drawnRectOf: (objectId) =>
        objectId === 300n ? spriteRect(6, 6, 1, TILE) : drawnRects.get(objectId),
    });
    // The centre of cell (6, 6): inside the wall's own sprite, and one
    // whole cell east of anything the bin draws.
    const besideTheBin: PickPoint = {
      cellX: 6,
      cellY: 6,
      worldXPx: 6 * TILE + TILE / 2,
      worldYPx: 6 * TILE + TILE / 2,
    };
    // Guard the guard: the bin must really be a candidate here, or this
    // test would pass for the same reason the old one did.
    expect(overhangCells["0:6:6"].map((e) => e.objectId)).toContain(100n);
    expect(topmostAt(besideTheBin, 0, withOverhang)?.objectId).toBe(300n);
  });

  it("a click below a prop's own drawn sprite never hits it", () => {
    // Two rows south of the bin: its cell entry is not there, and its
    // rect does not reach either.
    expect(topmostAt(atCell(5, 9), 0, ctx())).toBeUndefined();
  });

  it("the upper rows of a wide prop resolve to it", () => {
    // The counter: 3 cells wide, art 64px tall on a 1-cell-tall
    // footprint, so most of it is drawn above its own row.
    const counter = entry({ objectId: 300n, defId: COUNTER_DEF, anchorX: 4, anchorY: 2 });
    const counterCells: Record<string, FootprintEntry[]> = {};
    for (let cx = 4; cx <= 6; cx++) {
      for (let cy = -1; cy <= 2; cy++) counterCells[`0:${cx}:${cy}`] = [counter];
    }
    const counterCtx = contextOf(queryOf(counterCells), {
      drawnRectOf: () => spriteRect(4, 2, 3, 64),
    });
    // The top row of its art, three cells up from its own anchor row.
    const topOfCounter: PickPoint = {
      cellX: 5,
      cellY: -1,
      worldXPx: 5 * TILE + TILE / 2,
      worldYPx: -1 * TILE + TILE / 2,
    };
    expect(topmostAt(topOfCounter, 0, counterCtx)?.objectId).toBe(300n);
  });

  it("inv_pick_hits_only_what_is_drawn_at_the_point", () => {
    // The broad phase over-registers on purpose, so the narrow phase is
    // what makes a pick correct. For any set of candidates on one cell --
    // some drawn over the point, some drawn elsewhere, some drawing
    // nothing at all, each independently visible -- the pick is whatever
    // the renderer's own sort draws last among the ones actually there.
    const POINT: PickPoint = { cellX: 3, cellY: 3, worldXPx: 56, worldYPx: 56 };
    const rectArb = fc.oneof(
      // Contains the point.
      fc.constant<PickRect | undefined>({ x0: 48, y0: 48, x1: 64, y1: 64 }),
      // Misses it: east of it, and north of it.
      fc.constant<PickRect | undefined>({ x0: 64, y0: 48, x1: 80, y1: 64 }),
      fc.constant<PickRect | undefined>({ x0: 48, y0: 0, x1: 64, y1: 16 }),
      // Draws nothing, so it keeps the cell it was found under.
      fc.constant<PickRect | undefined>(undefined),
    );

    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 400 }).map(BigInt), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.array(fc.constantFrom(...LAYER_CODES), { minLength: 8, maxLength: 8 }),
        fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        fc.array(rectArb, { minLength: 8, maxLength: 8 }),
        fc.array(fc.integer({ min: -2, max: 2 }), { minLength: 8, maxLength: 8 }),
        (ids, layers, visibility, rects, rowOffsets) => {
          const candidates = ids.map((objectId, i) =>
            entry({
              objectId,
              layer: layers[i] as number,
              anchorX: 3,
              anchorY: 3 + (rowOffsets[i] as number),
            }),
          );
          const rectById = new Map<bigint, PickRect | undefined>(
            candidates.map((c, i) => [c.objectId, rects[i]]),
          );
          const visible = new Set(
            candidates.filter((_, i) => visibility[i]).map((c) => c.objectId),
          );
          const ctx = contextOf(queryOf({ "0:3:3": candidates }), {
            isVisible: (objectId) => visible.has(objectId),
            drawnRectOf: (objectId) => rectById.get(objectId),
          });

          const picked = topmostAt(POINT, 0, ctx);

          // Oracle: everything visible that is actually drawn over the
          // point (or draws nothing at all), ordered by the renderer's
          // own sort, last one wins.
          const eligible = candidates.filter((c) => {
            if (!visible.has(c.objectId)) return false;
            const rect = rectById.get(c.objectId);
            if (!rect) return true;
            return (
              POINT.worldXPx >= rect.x0 &&
              POINT.worldXPx < rect.x1 &&
              POINT.worldYPx >= rect.y0 &&
              POINT.worldYPx < rect.y1
            );
          });
          if (eligible.length === 0) {
            expect(picked).toBeUndefined();
            return;
          }
          const keyed = eligible.map((c) => ({
            candidate: c,
            key: pickSortKey(c, 0, ctx),
          }));
          const keys = keyed.map((k) => k.key);
          sortDrawablesInPlace(keys);
          const front = keys[keys.length - 1];
          expect(picked?.objectId).toBe(keyed.find((k) => k.key === front)?.candidate.objectId);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("an object with no drawn rect at all still resolves by its own footprint cell", () => {
    // Undrawn collider-only geometry (the world boundary ring) has no
    // sprite: it must not vanish from picking, nor be pickable outside
    // its own cells.
    const undrawn = entry({ objectId: 400n, defId: PLAIN_PROP_DEF, anchorX: 1, anchorY: 1 });
    const undrawnCtx = contextOf(queryOf({ "0:1:1": [undrawn] }), {
      drawnRectOf: () => undefined,
    });
    expect(topmostAt(atCell(1, 1), 0, undrawnCtx)?.objectId).toBe(400n);
  });
});

describe("resolveClick", () => {
  const binCell = {
    "0:5:5": [entry({ objectId: 100n, defId: TRASH_BIN_DEF, anchorX: 5, anchorY: 5 })],
  };

  it("emits exactly one intent for a reachable object (AC1)", () => {
    const ctx = contextOf(queryOf(binCell));
    expect(resolveClick(atCell(5, 5), 0, player(5.5, 5.5), ctx)).toEqual({
      intent: { objectId: 100n, defId: TRASH_BIN_DEF },
    });
  });

  it("the intent carries an object instance and its definition, and nothing else (AC3)", () => {
    const ctx = contextOf(queryOf(binCell));
    const result = resolveClick(atCell(5, 5), 0, player(5.5, 5.5), ctx);
    const intent = (result as { intent: Intent }).intent;
    expect(intent).toStrictEqual({ objectId: 100n, defId: TRASH_BIN_DEF });
    expect(Object.keys(intent).sort()).toEqual(["defId", "objectId"]);
  });

  it("emits no intent and reports the ignore when the object is out of reach (AC2)", () => {
    const ctx = contextOf(queryOf(binCell));
    expect(resolveClick(atCell(5, 5), 0, player(20, 20), ctx)).toEqual({ ignored: 100n });
  });

  it("resolves nothing at all on empty ground -- no intent and no ignore", () => {
    const ctx = contextOf(queryOf(binCell));
    expect(resolveClick(atCell(1, 1), 0, player(1.5, 1.5), ctx)).toBeUndefined();
  });

  it("resolves nothing at all on a prop that declares no interaction", () => {
    const cells = {
      "0:5:5": [entry({ objectId: 200n, defId: PLAIN_PROP_DEF, anchorX: 5, anchorY: 5 })],
    };
    expect(
      resolveClick(atCell(5, 5), 0, player(5.5, 5.5), contextOf(queryOf(cells))),
    ).toBeUndefined();
  });

  it("resolves nothing for an object whose definition the client has not got", () => {
    const cells = { "0:5:5": [entry({ objectId: 300n, defId: 999, anchorX: 5, anchorY: 5 })] };
    expect(
      resolveClick(atCell(5, 5), 0, player(5.5, 5.5), contextOf(queryOf(cells))),
    ).toBeUndefined();
  });

  it("a click on any cell of a wide object reaches it from anywhere in its own reach row", () => {
    const counter = entry({ objectId: 400n, defId: COUNTER_DEF, anchorX: 4, anchorY: 2 });
    const ctx = contextOf(queryOf({ "0:4:2": [counter], "0:5:2": [counter], "0:6:2": [counter] }));
    for (const cellX of [4, 5, 6]) {
      expect(resolveClick(atCell(cellX, 2), 0, player(6.9, 3.5), ctx)).toEqual({
        intent: { objectId: 400n, defId: COUNTER_DEF },
      });
    }
    expect(resolveClick(atCell(5, 2), 0, player(5.5, 4.5), ctx)).toEqual({ ignored: 400n });
  });

  it("inv_unreachable_never_emits", () => {
    // For any placement, any declared reach rect and any player position,
    // a click on the object is exactly one of an intent or an ignore, and
    // which one always agrees with the independent continuous-coordinate
    // model -- never with a restatement of the implementation.
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 10 }),
        fc.integer({ min: -10, max: 10 }),
        fc.integer({ min: -32, max: 0 }),
        fc.integer({ min: -32, max: 0 }),
        fc.integer({ min: 1, max: 48 }),
        fc.integer({ min: 1, max: 48 }),
        fc.constantFrom(4, 8, 16, 32),
        fc.constantFrom(-1, 0, 1),
        fc.double({ min: -15, max: 15, noNaN: true }),
        fc.double({ min: -15, max: 15, noNaN: true }),
        (anchorX, anchorY, x0, y0, spanX, spanY, subcellsPerCell, playerFloor, px, py) => {
          const rect = { x0, y0, x1: x0 + spanX, y1: y0 + spanY };
          const DEF_ID = 7;
          const candidate = entry({ objectId: 55n, defId: DEF_ID, anchorX, anchorY });
          const ctx: PickContext = {
            index: queryOf({ [`0:${anchorX}:${anchorY}`]: [candidate] }),
            objectDefs: new Map([[DEF_ID, { width: 1, height: 1, interactAt: rect }]]),
            rankOf,
            subcellsPerCell,
          };
          const p = player(px, py, playerFloor);
          const result = resolveClick(atCell(anchorX, anchorY), 0, p, ctx);

          const feetX = Math.floor(px * subcellsPerCell) / subcellsPerCell;
          const feetY = Math.floor(py * subcellsPerCell) / subcellsPerCell;
          const reachable =
            playerFloor === 0 &&
            feetX >= anchorX + rect.x0 / subcellsPerCell &&
            feetX < anchorX + rect.x1 / subcellsPerCell &&
            feetY >= anchorY + rect.y0 / subcellsPerCell &&
            feetY < anchorY + rect.y1 / subcellsPerCell;

          if (reachable) {
            expect(result).toEqual({ intent: { objectId: 55n, defId: DEF_ID } });
          } else {
            expect(result).toEqual({ ignored: 55n });
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("an intent means nothing by itself: two consumers give the same one different meanings", () => {
    const ctx = contextOf(queryOf(binCell));
    const result = resolveClick(atCell(5, 5), 0, player(5.5, 5.5), ctx);
    const intent = (result as { intent: Intent }).intent;

    const openedShop: bigint[] = [];
    const tookOutRubbish: bigint[] = [];
    for (const consume of [
      (i: Intent) => openedShop.push(i.objectId),
      (i: Intent) => tookOutRubbish.push(i.objectId),
    ]) {
      consume(intent);
    }
    expect(openedShop).toEqual([100n]);
    expect(tookOutRubbish).toEqual([100n]);
  });

  it("a pick costs one cell lookup, whatever else the world holds", () => {
    let lookups = 0;
    const counting: FootprintQuery = {
      objectsAt(floor, cellX, cellY) {
        lookups++;
        return queryOf(binCell).objectsAt(floor, cellX, cellY);
      },
    };
    resolveClick(atCell(5, 5), 0, player(5.5, 5.5), contextOf(counting));
    expect(lookups).toBe(1);
  });
});
