import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Intent } from "../../../src/input/intent";
import type { PickContext, PickPlayer } from "../../../src/input/pick";
import { isWithinReach, resolveClick, topmostAt } from "../../../src/input/pick";
import type { FootprintEntry, FootprintQuery } from "../../../src/world/footprint-index";

const SUBCELLS = 16;

// Layer codes are arbitrary here; `rankOf` is what turns one into an
// FR123 rank, exactly as the real scene does.
const FURNITURE_LAYER = 10;
const OBJECTS_LAYER = 20;
const RANKS: Readonly<Record<number, number>> = { [FURNITURE_LAYER]: 10, [OBJECTS_LAYER]: 20 };

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
  return {
    defId: 1,
    layer: OBJECTS_LAYER,
    anchorX: 0,
    anchorY: 0,
    ...overrides,
  };
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
    rankOf: (layer) => RANKS[layer] ?? 0,
    subcellsPerCell: SUBCELLS,
    ...overrides,
  };
}

function player(x: number, y: number, floor = 0): PickPlayer {
  return { x, y, floor };
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
    // y = 6 exactly is sub-cell 96, the rect's own y0 -- inside.
    expect(isWithinReach(anchored, def, player(5.5, 6), 0, SUBCELLS)).toBe(true);
    // y = 7 exactly is sub-cell 112, the rect's own y1 -- outside.
    expect(isWithinReach(anchored, def, player(5.5, 7), 0, SUBCELLS)).toBe(false);
    // x = 5 is x0 (inside); x = 6 is x1 (outside).
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
});

describe("topmostAt", () => {
  it("inv_pick_resolves_topmost_drawn", () => {
    // For any two objects sharing a cell, the one the pick returns is the
    // one the FR123 comparator orders last -- i.e. the one drawn on top.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }).map(BigInt),
        fc.integer({ min: 1, max: 50 }).map(BigInt),
        fc.constantFrom(FURNITURE_LAYER, OBJECTS_LAYER),
        fc.constantFrom(FURNITURE_LAYER, OBJECTS_LAYER),
        (idA, idB, layerA, layerB) => {
          fc.pre(idA !== idB);
          const a = entry({ objectId: idA, layer: layerA });
          const b = entry({ objectId: idB, layer: layerB });
          const ctx = contextOf(queryOf({ "0:2:2": [a, b] }));
          const picked = topmostAt(2, 2, 0, ctx);

          // The expected winner, derived from the same key the renderer
          // sorts by: higher rank draws later; equal ranks tie-break on
          // the stable id.
          const rankA = RANKS[layerA] ?? 0;
          const rankB = RANKS[layerB] ?? 0;
          const expected = rankA !== rankB ? (rankA > rankB ? idA : idB) : idA > idB ? idA : idB;
          expect(picked?.objectId).toBe(expected);
        },
      ),
    );
  });

  it("insertion order never decides the winner", () => {
    const front = entry({ objectId: 1n, layer: OBJECTS_LAYER });
    const back = entry({ objectId: 2n, layer: FURNITURE_LAYER });
    expect(topmostAt(2, 2, 0, contextOf(queryOf({ "0:2:2": [front, back] })))?.objectId).toBe(1n);
    expect(topmostAt(2, 2, 0, contextOf(queryOf({ "0:2:2": [back, front] })))?.objectId).toBe(1n);
  });

  it("an empty cell resolves to nothing", () => {
    expect(topmostAt(9, 9, 0, contextOf(queryOf({})))).toBeUndefined();
  });

  it("an object the enclosure rules have hidden can never be picked", () => {
    const hidden = entry({ objectId: 1n, layer: OBJECTS_LAYER });
    const behind = entry({ objectId: 2n, layer: FURNITURE_LAYER });
    const ctx = contextOf(queryOf({ "0:2:2": [hidden, behind] }), {
      isVisible: (objectId) => objectId !== 1n,
    });
    // Not merely "not returned": the retracted wall must not block the
    // click from reaching what is now visible behind it.
    expect(topmostAt(2, 2, 0, ctx)?.objectId).toBe(2n);
  });

  it("a cell where everything is hidden resolves to nothing", () => {
    const ctx = contextOf(queryOf({ "0:2:2": [entry({ objectId: 1n })] }), {
      isVisible: () => false,
    });
    expect(topmostAt(2, 2, 0, ctx)).toBeUndefined();
  });
});

describe("resolveClick", () => {
  // The bin is anchored at (5, 5); its reach rect covers a quarter-cell
  // skirt around its own cell.
  const binCell = {
    "0:5:5": [entry({ objectId: 100n, defId: TRASH_BIN_DEF, anchorX: 5, anchorY: 5 })],
  };

  it("emits exactly one intent for a reachable object (AC1)", () => {
    const ctx = contextOf(queryOf(binCell));
    const result = resolveClick(5.5, 5.5, 0, player(5.5, 5.5), ctx);
    expect(result).toEqual({ intent: { objectId: 100n, defId: TRASH_BIN_DEF } });
  });

  it("the intent carries an object instance and its definition, and nothing else (AC3)", () => {
    const ctx = contextOf(queryOf(binCell));
    const result = resolveClick(5.5, 5.5, 0, player(5.5, 5.5), ctx);
    const intent = (result as { intent: Intent }).intent;
    // No verb, no action, no kind: nothing here encodes what a click
    // means. Asserted exactly, so a field added later fails this test.
    expect(intent).toStrictEqual({ objectId: 100n, defId: TRASH_BIN_DEF });
    expect(Object.keys(intent).sort()).toEqual(["defId", "objectId"]);
  });

  it("emits no intent and reports the ignore when the object is out of reach (AC2)", () => {
    const ctx = contextOf(queryOf(binCell));
    const result = resolveClick(5.5, 5.5, 0, player(20, 20), ctx);
    expect(result).toEqual({ ignored: 100n });
  });

  it("resolves nothing at all on empty ground -- no intent and no ignore", () => {
    const ctx = contextOf(queryOf(binCell));
    expect(resolveClick(1.5, 1.5, 0, player(1.5, 1.5), ctx)).toBeUndefined();
  });

  it("resolves nothing at all on a prop that declares no interaction", () => {
    const cells = {
      "0:5:5": [entry({ objectId: 200n, defId: PLAIN_PROP_DEF, anchorX: 5, anchorY: 5 })],
    };
    const ctx = contextOf(queryOf(cells));
    expect(resolveClick(5.5, 5.5, 0, player(5.5, 5.5), ctx)).toBeUndefined();
  });

  it("resolves nothing for an object whose definition the client has not got", () => {
    const cells = { "0:5:5": [entry({ objectId: 300n, defId: 999, anchorX: 5, anchorY: 5 })] };
    expect(resolveClick(5.5, 5.5, 0, player(5.5, 5.5), contextOf(queryOf(cells)))).toBeUndefined();
  });

  it("a click on a cell of a wide object reaches it from anywhere in its own reach row", () => {
    // The counter is anchored at (4, 2) and is three cells wide, so all
    // three of its cells resolve to the same instance, and the reach row
    // is y = 3 across its whole width.
    const counter = entry({ objectId: 400n, defId: COUNTER_DEF, anchorX: 4, anchorY: 2 });
    const ctx = contextOf(queryOf({ "0:4:2": [counter], "0:5:2": [counter], "0:6:2": [counter] }));
    for (const cellX of [4, 5, 6]) {
      expect(resolveClick(cellX + 0.5, 2.5, 0, player(6.9, 3.5), ctx)).toEqual({
        intent: { objectId: 400n, defId: COUNTER_DEF },
      });
    }
    // One row further south is outside the reach rect.
    expect(resolveClick(5.5, 2.5, 0, player(5.5, 4.5), ctx)).toEqual({ ignored: 400n });
  });

  it("inv_unreachable_never_emits", () => {
    // For any player position, a click on the object resolves to exactly
    // one of: an intent (reachable) or an ignore (not) -- never both,
    // never neither, and the choice always agrees with `isWithinReach`.
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 40, noNaN: true }),
        fc.double({ min: -20, max: 40, noNaN: true }),
        fc.constantFrom(-1, 0, 1),
        (px, py, floor) => {
          const ctx = contextOf(queryOf(binCell));
          const p = player(px, py, floor);
          const result = resolveClick(5.5, 5.5, 0, p, ctx);
          const reachable = isWithinReach(
            { anchorX: 5, anchorY: 5 },
            { width: 1, height: 1, interactAt: { x0: -4, y0: -4, x1: 20, y1: 20 } },
            p,
            0,
            SUBCELLS,
          );
          if (reachable) {
            expect(result).toEqual({ intent: { objectId: 100n, defId: TRASH_BIN_DEF } });
          } else {
            expect(result).toEqual({ ignored: 100n });
          }
        },
      ),
    );
  });

  it("an intent means nothing by itself: two consumers give the same one different meanings", () => {
    const ctx = contextOf(queryOf(binCell));
    const result = resolveClick(5.5, 5.5, 0, player(5.5, 5.5), ctx);
    const intent = (result as { intent: Intent }).intent;

    const openedShop: bigint[] = [];
    const tookOutRubbish: bigint[] = [];
    const consumers: ((i: Intent) => void)[] = [
      (i) => openedShop.push(i.objectId),
      (i) => tookOutRubbish.push(i.objectId),
    ];
    for (const consume of consumers) consume(intent);

    // The emitter neither knows nor cares which of these it caused.
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
    resolveClick(5.5, 5.5, 0, player(5.5, 5.5), contextOf(counting));
    expect(lookups).toBe(1);
  });
});
