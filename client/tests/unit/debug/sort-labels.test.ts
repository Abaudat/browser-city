import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEBUG_STYLE } from "../../../src/debug/debug-style";
import { buildSortLabels, parseSortLabel } from "../../../src/debug/sort-labels";
import type { DebugWorldView } from "../../../src/debug/world-view";
import { screenPositionPx } from "../../../src/render/screen-position";
import type { Drawable } from "../../../src/render/sort-key";
import { compareDrawables } from "../../../src/render/sort-key";
import { fromSortUnits, toSortUnits } from "../../../src/render/sort-units";

const TILE = 16;
const STOREY = 48;

function drawable(over: Partial<Drawable> & { stableId: bigint }): Drawable {
  return { x: 0, y: 0, rank: 20, floor: 0, ...over };
}

function viewOver(
  pool: readonly Drawable[],
  order: readonly bigint[] = pool.map((d) => d.stableId),
  bounds = { floor: 0, cellX0: -8, cellY0: -8, cellX1: 8, cellY1: 8 },
): DebugWorldView {
  return {
    tileSizePx: TILE,
    storeyHeightPx: STOREY,
    colliderSubcellsPerCell: 16,
    viewerFloor: () => bounds.floor,
    viewportCells: () => bounds,
    entriesInCell: () => [],
    objects: () => [],
    pool: () => pool,
    orderOf: (id) => {
      const index = order.indexOf(id);
      return index === -1 ? undefined : index;
    },
  };
}

describe("buildSortLabels", () => {
  it("prints the key compareDrawables actually orders by, in sort units", () => {
    const d = drawable({ stableId: 7n, x: toSortUnits(3), y: toSortUnits(5), rank: 30 });
    const [label] = buildSortLabels(viewOver([d]));
    // Computed independently here, from the drawable's own fields.
    expect(label?.label).toBe(`y${toSortUnits(5)} r30 x${toSortUnits(3)} #7`);
  });

  it("prints the order the renderer resolved, not one it worked out itself", () => {
    const a = drawable({ stableId: 1n, y: toSortUnits(9) });
    const b = drawable({ stableId: 2n, y: toSortUnits(1) });
    // A deliberately wrong order: the overlay must show what was applied.
    const labels = buildSortLabels(viewOver([a, b], [1n, 2n]));
    expect(labels.map((l) => l.orderLabel)).toEqual(["[0]", "[1]"]);
  });

  it("says so when a drawable is in no pool right now, rather than printing a lie", () => {
    const d = drawable({ stableId: 3n });
    const [label] = buildSortLabels(viewOver([d], []));
    expect(label?.orderLabel).toBe("[?]");
  });

  it("puts the label at the drawable's own anchor, through the renderer's projection", () => {
    // `x` in sort units is 8 here, which takes stagger lane 8 % 3 = 2.
    const d = drawable({ stableId: 4n, x: toSortUnits(2), y: toSortUnits(6) });
    const [label] = buildSortLabels(viewOver([d]));
    const anchor = screenPositionPx(fromSortUnits(d.x), fromSortUnits(d.y), 0, TILE, STOREY);
    expect(label?.x).toBe(anchor.x);
    // Lifted by whole lanes only: the horizontal position is always the
    // drawable's own anchor, so a label always belongs to the column it
    // sits over.
    expect((anchor.y - (label?.y ?? 0)) % (DEBUG_STYLE.lineHeightPx * 2)).toBe(0);
  });

  it("staggers adjacent drawables onto different baselines so a crowded row stays legible (AC3)", () => {
    // A run of one-tile props: each key is far wider than a tile, so
    // without staggering every label would print over its neighbours'.
    const row = [0, 1, 2, 3].map((i) =>
      drawable({ stableId: BigInt(i + 1), x: toSortUnits(i), y: toSortUnits(2) }),
    );
    const labels = buildSortLabels(viewOver(row));
    expect(labels).toHaveLength(4);
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i]?.y).not.toBe(labels[i - 1]?.y);
    }
  });

  it("puts a drawable in the same lane every time, whatever else is on screen", () => {
    const d = drawable({ stableId: 9n, x: toSortUnits(3), y: toSortUnits(3) });
    const alone = buildSortLabels(viewOver([d]))[0]?.y;
    const crowded = buildSortLabels(
      viewOver([drawable({ stableId: 8n, x: toSortUnits(2), y: toSortUnits(3) }), d]),
    )[1]?.y;
    expect(crowded).toBe(alone);
  });

  it("staggers a negative sort-key position without ever landing outside its lanes", () => {
    const west = drawable({ stableId: 1n, x: toSortUnits(-1), y: toSortUnits(0) });
    const [label] = buildSortLabels(viewOver([west]));
    const anchor = screenPositionPx(fromSortUnits(west.x), fromSortUnits(west.y), 0, TILE, STOREY);
    const lift = anchor.y - (label?.y ?? 0);
    expect(lift).toBeGreaterThanOrEqual(0);
    expect(lift).toBeLessThanOrEqual(2 * DEBUG_STYLE.lineHeightPx * 2);
  });

  it("labels only the viewer's own floor, and only what is on screen", () => {
    const here = drawable({ stableId: 1n, x: toSortUnits(0), y: toSortUnits(0), floor: 0 });
    const upstairs = drawable({ stableId: 2n, x: toSortUnits(0), y: toSortUnits(0), floor: 1 });
    const offscreen = drawable({ stableId: 3n, x: toSortUnits(50), y: toSortUnits(50), floor: 0 });
    const labels = buildSortLabels(viewOver([here, upstairs, offscreen]));
    expect(labels.map((l) => l.stableId)).toEqual([1n]);
  });

  it("culls on every side of the viewport, not only past its far corner", () => {
    const bounds = { floor: 0, cellX0: 0, cellY0: 0, cellX1: 4, cellY1: 4 };
    const west = drawable({ stableId: 1n, x: toSortUnits(-3), y: toSortUnits(2) });
    const north = drawable({ stableId: 2n, x: toSortUnits(2), y: toSortUnits(-3) });
    const inside = drawable({ stableId: 3n, x: toSortUnits(2), y: toSortUnits(2) });
    const east = drawable({ stableId: 4n, x: toSortUnits(40), y: toSortUnits(2) });
    const labels = buildSortLabels(viewOver([west, north, inside, east], [], bounds));
    expect(labels.map((l) => l.stableId)).toEqual([3n]);
  });

  it("keeps a bigint stable id exact, never narrowed through Number", () => {
    const huge = 9007199254740993n; // Number.MAX_SAFE_INTEGER + 2
    const [label] = buildSortLabels(viewOver([drawable({ stableId: huge })]));
    expect(label?.label).toContain(`#${huge.toString()}`);
  });

  // A label that cannot be read back into the key it claims to show is
  // decoration. This is the round trip, and the property below is what
  // makes it mean something.
  it("round-trips: a printed label parses back to the key it was printed from", () => {
    const d = drawable({ stableId: 12345678901234567890n, x: -7, y: 42, rank: 50 });
    const [label] = buildSortLabels(
      viewOver([d], [d.stableId], {
        floor: 0,
        cellX0: -1000,
        cellY0: -1000,
        cellX1: 1000,
        cellY1: 1000,
      }),
    );
    expect(label && parseSortLabel(label.label)).toEqual({
      x: -7,
      y: 42,
      rank: 50,
      stableId: 12345678901234567890n,
      floor: 0,
    });
  });

  it("parseSortLabel refuses anything that is not one of its own labels", () => {
    expect(parseSortLabel("not a key")).toBeUndefined();
    expect(parseSortLabel("y1 r2 x3")).toBeUndefined();
  });

  // Quentin's direction: ordering the drawables by what the overlay
  // *printed* must reproduce `compareDrawables`' own order over the
  // originals. If the readout drops, rounds or reorders a component of
  // the key, this fails -- without this module ever owning a second
  // comparator.
  it("inv_sort_overlay_labels_are_the_sort_key", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            stableId: fc.bigInt({ min: 1n, max: 10n ** 19n }),
            x: fc.integer({ min: -400, max: 400 }),
            y: fc.integer({ min: -400, max: 400 }),
            rank: fc.constantFrom(10, 20, 30, 40, 50),
          }),
          { minLength: 2, maxLength: 20 },
        ),
        (specs) => {
          const seen = new Set<bigint>();
          const pool: Drawable[] = [];
          for (const spec of specs) {
            if (seen.has(spec.stableId)) continue;
            seen.add(spec.stableId);
            pool.push(drawable(spec));
          }
          const labels = buildSortLabels(
            viewOver(pool, [], {
              floor: 0,
              cellX0: -1000,
              cellY0: -1000,
              cellX1: 1000,
              cellY1: 1000,
            }),
          );
          expect(labels).toHaveLength(pool.length);

          const fromLabels = labels.map((l) => {
            const parsed = parseSortLabel(l.label);
            if (!parsed) throw new Error(`unparseable label: ${l.label}`);
            return parsed;
          });
          const byLabel = [...fromLabels].sort(compareDrawables).map((d) => d.stableId);
          const byDrawable = [...pool].sort(compareDrawables).map((d) => d.stableId);
          expect(byLabel).toEqual(byDrawable);
        },
      ),
      { numRuns: 60 },
    );
  });
});
