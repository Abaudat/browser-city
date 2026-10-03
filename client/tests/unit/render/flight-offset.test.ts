// FR182 (story 15.15): the flight offset is a pure function of position and
// floor. Synthetic geometry mirrors the street's own pair: a three-cell flight
// on the street (open edge east, anchor west) and a two-cell flight on the
// platform (open edge west, anchor east).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildFlights, FlightIndex } from "../../../src/render/flight-offset";
import { snapToScreenPx, worldPointPx } from "../../../src/render/screen-position";
import {
  STAIRS_X,
  STAIRS_Y,
  STREET_TRANSITIONS,
  SUBWAY_FLOOR,
  streetPlacedRows,
} from "../../../src/test-street/fixture";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import { bodyRect, type MovementConfig } from "../../../src/world/movement";
import type { TransitionSpec } from "../../../src/world/transitions";
import {
  committedDefs,
  streetMovementConfig,
  streetObjectSources,
  streetTransitionIndex,
  streetWorldIndex,
} from "../test-street/street-world";

const TILE = 16;
const STOREY = 48;
const ZOOM = 3;

const config: MovementConfig = streetMovementConfig();

// Street: treads x 10..12 on row 5, anchor (10, 5); walking west is `d`.
// Platform (floor -1): flight x 19..20, rows 2..3, up anchor (20, 2).
const TRANSITIONS: readonly TransitionSpec[] = [
  { x: 10, y: 5, floor: 0, targetX: 19, targetY: 2, targetFloor: -1 },
  { x: 20, y: 2, floor: -1, targetX: 11, targetY: 5, targetFloor: 0 },
];
const SOURCES = new Map([
  [1, { width: 3, height: 1, flightDropPx: 8 }],
  [2, { width: 2, height: 2, flightDropPx: 4 }],
  [3, { width: 1, height: 1 }],
]);
const STREET_ROW = { defId: 1, x: 10, y: 5, floor: 0 };
const PLATFORM_ROW = { defId: 2, x: 19, y: 3, floor: -1 };
const PROP_ROW = { defId: 3, x: 30, y: 30, floor: 0 };

function synthetic(): FlightIndex {
  return new FlightIndex(
    buildFlights(TRANSITIONS, [STREET_ROW, PLATFORM_ROW, PROP_ROW], SOURCES, STOREY),
    config,
  );
}

describe("flight offset (FR182)", () => {
  it("inv_stair_offset_is_zero_off_a_flight: exactly +0, never -0, anywhere else", () => {
    const index = synthetic();
    const sub = config.subcellsPerCell;
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 60, noNaN: true }),
        fc.double({ min: -20, max: 60, noNaN: true }),
        fc.integer({ min: -2, max: 3 }),
        (x, y, floor) => {
          const body = bodyRect({ x, y }, config);
          const onStreet =
            floor === 0 &&
            body.x1 > 10 * sub &&
            body.x0 < 13 * sub &&
            body.y1 > 5 * sub &&
            body.y0 < 6 * sub;
          const onPlatform =
            floor === -1 &&
            body.x1 > 19 * sub &&
            body.x0 < 21 * sub &&
            body.y1 > 2 * sub &&
            body.y0 < 4 * sub;
          fc.pre(!onStreet && !onPlatform);
          expect(Object.is(index.offsetPx(x, y, floor), 0)).toBe(true);
        },
      ),
    );
  });

  it("is zero at the open edge and the full signed drop at the anchor cell's entry edge", () => {
    const index = synthetic();
    expect(index.offsetPx(13, 5.9, 0)).toBe(0);
    expect(index.offsetPx(11, 5.9, 0)).toBe(8);
    expect(index.offsetPx(10.5, 5.9, 0)).toBe(8); // flat inside the anchor cell
    // The platform flight rises toward the street: signed by the two floors.
    expect(index.offsetPx(19, 2.9, -1)).toBe(0);
    expect(index.offsetPx(20, 2.9, -1)).toBe(-4);
  });

  it("inv_stair_offset_is_monotonic_and_bounded along the walk, for any length and drop", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 1, max: 48 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (length, drop, a, b) => {
          const flights = buildFlights(
            TRANSITIONS,
            [
              { defId: 1, x: 10, y: 5, floor: 0 },
              { defId: 2, x: 20 - length + 1, y: 3, floor: -1 },
            ],
            new Map([
              [1, { width: 3, height: 1, flightDropPx: drop }],
              [2, { width: length, height: 2, flightDropPx: drop }],
            ]),
            STOREY,
          );
          const index = new FlightIndex(flights, config);
          const [near, far] = a < b ? [a, b] : [b, a];
          // Walking west on the street: x decreases, the drop only grows.
          const o1 = index.offsetPx(13 - 3 * near, 5.9, 0);
          const o2 = index.offsetPx(13 - 3 * far, 5.9, 0);
          expect(o2).toBeGreaterThanOrEqual(o1);
          expect(o1).toBeGreaterThanOrEqual(0);
          expect(o2).toBeLessThanOrEqual(drop);
          // Walking east on the platform: x increases, the (negative) drop grows.
          const p1 = index.offsetPx(20 - length + 1 + near * (length - 1), 2.9, -1);
          const p2 = index.offsetPx(20 - length + 1 + far * (length - 1), 2.9, -1);
          expect(p2).toBeLessThanOrEqual(p1);
          expect(p1).toBeLessThanOrEqual(0);
          expect(p2).toBeGreaterThanOrEqual(-drop);
        },
      ),
    );
  });

  it("inv_stair_offset_is_direction_independent: a function of position only", () => {
    const index = synthetic();
    fc.assert(
      fc.property(fc.double({ min: 9.5, max: 13.4, noNaN: true }), (x) => {
        const first = index.offsetPx(x, 5.9, 0);
        index.offsetPx(x + 0.7, 5.9, 0); // an interleaved call changes nothing
        expect(index.offsetPx(x, 5.9, 0)).toBe(first);
      }),
    );
  });

  it("holds the offset for a body resting on the near railing's boundary row", () => {
    // Feet exactly on the row boundary below the tread row: outside the
    // tread cell by the feet, inside it by the body.
    expect(synthetic().offsetPx(11.5, 6, 0)).toBeGreaterThan(0);
  });

  it("is added before the one whole-pixel snap, never snapped separately", () => {
    for (const off of [0, 1, 2.5, 3.3333, 5.3333, 8]) {
      for (const y of [5.9, 5.93, 6]) {
        const drawn = worldPointPx(11.5, y, 0, TILE, STOREY, ZOOM, off);
        expect(drawn.y).toBe(snapToScreenPx(y * TILE + off, ZOOM));
        expect(Number.isInteger(drawn.y * ZOOM)).toBe(true);
      }
    }
  });

  it("refuses two flights on one anchor and a flight whose anchor is not its far end", () => {
    expect(() =>
      buildFlights(
        TRANSITIONS,
        [STREET_ROW, { ...STREET_ROW }, PLATFORM_ROW],
        SOURCES,
        STOREY,
      ),
    ).toThrow(/two flights/);
    expect(() =>
      buildFlights(TRANSITIONS, [{ ...STREET_ROW, x: 9 }, PLATFORM_ROW], SOURCES, STOREY),
    ).toThrow(/far end/);
  });

  it("has no flight for an anchor no flight object covers", () => {
    expect(buildFlights(TRANSITIONS, [PROP_ROW], SOURCES, STOREY)).toEqual([]);
  });
});

describe("the street's own flights (conformance)", () => {
  const defs = committedDefs();
  const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
  const flights = buildFlights(
    STREET_TRANSITIONS,
    streetPlacedRows(),
    streetObjectSources(),
    storey,
  );

  it("both subway anchors resolve exactly one flight; the footbridge's resolves none", () => {
    expect(flights.map((f) => f.floor).sort()).toEqual([SUBWAY_FLOOR, 0]);
  });

  it("takes each drop from the declared art, signed toward the target floor", () => {
    const declared = new Map(
      defs.objects.filter((o) => o.flightDropPx !== undefined).map((o) => [o.key, o.flightDropPx]),
    );
    expect([...declared.keys()].sort()).toEqual(["platform_stair_flight", "stairwell_treads"]);
    expect(flights.find((f) => f.floor === 0)?.dropPx).toBe(declared.get("stairwell_treads"));
    expect(flights.find((f) => f.floor === SUBWAY_FLOOR)?.dropPx).toBe(
      -(declared.get("platform_stair_flight") as number),
    );
  });

  it("a real walk down and back up never pops between ticks; the landing is already on a tread", () => {
    const index = new FlightIndex(flights, config);
    const world = streetWorldIndex();
    const transitions = streetTransitionIndex();
    let state = {
      ...initialFloorWalkState(STAIRS_X + 3.4, STAIRS_Y + 0.9, 0),
      transitioned: false,
    };
    const samples: { off: number; floor: number; transitioned: boolean }[] = [];
    const walk = (dir: number, until: (floor: number) => boolean) => {
      for (let i = 0; i < 4000; i++) {
        state = stepAndTransition(state, { x: dir, y: 0 }, 16, world, config, transitions);
        samples.push({
          off: index.offsetPx(state.x, state.y, state.floor),
          floor: state.floor,
          transitioned: state.transitioned,
        });
        if (until(state.floor)) return;
      }
      throw new Error("walk did not finish");
    };
    walk(-1, (floor) => floor === SUBWAY_FLOOR);
    expect(samples[samples.length - 1]?.off).not.toBe(0);
    walk(1, (floor) => floor === 0);
    expect(samples[samples.length - 1]?.off).not.toBe(0);
    // One tick covers `walkSpeedCellsPerMs * 16` cells (px: * TILE), and a
    // flight drops at most its own `dropPx` over one cell of walking.
    const perTickPx = config.walkSpeedCellsPerMs * 16 * TILE;
    const steepest = Math.max(...flights.map((f) => Math.abs(f.dropPx)));
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (!a || !b || b.transitioned || a.floor !== b.floor) continue;
      expect(Math.abs(b.off - a.off)).toBeLessThanOrEqual((steepest * perTickPx) / TILE + 1e-9);
    }
  });
});
