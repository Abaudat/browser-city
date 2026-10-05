// FR182 (story 15.15): the flight offset is a pure function of position and
// floor. Synthetic geometry mirrors the street's own pair: a three-cell flight
// on the street (open edge east, anchor west) and a two-cell flight on the
// platform (open edge west, anchor east).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { buildFlights, FlightIndex } from "../../../src/render/flight-offset";
import { floorOffsetPx, snapToScreenPx, worldPointPx } from "../../../src/render/screen-position";
import {
  BRIDGE_DECK_DEF_ID,
  BRIDGE_FLIGHT_DEPTH,
  BRIDGE_FLIGHT_WIDTH,
  BRIDGE_FLIGHT_X0,
  BRIDGE_FLOOR,
  BRIDGE_UP_ANCHOR_Y,
  isDefStreetProp,
  STAIRS_X,
  STAIRS_Y,
  STREET_FLOOR,
  STREET_PROPS,
  STREET_TRANSITIONS,
  SUBWAY_FLOOR,
  streetPlacedRows,
} from "../../../src/test-street/fixture";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import { bodyRect, type MovementConfig } from "../../../src/world/movement";
import { isBodyClear } from "../../../src/world/standable";
import { pairTransitions, type TransitionSpec } from "../../../src/world/transitions";
import { fixtureExtent, fixtureFloors } from "../test-street/reachable";
import {
  committedDefs,
  streetMovementConfig,
  streetObjectSources,
  streetStandable,
  streetTransitionIndex,
  streetWorldIndex,
} from "../test-street/street-world";

/** Synthetic geometry: no far-end cell is a body's to stand in, so only the anchors are checked. */
const noStandableFarEnd = () => false;
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
  [1, { width: 3, height: 1, flight: { dropPx: 8, fromPx: 0, toPx: 32 } }],
  [2, { width: 2, height: 2, flight: { dropPx: 4, fromPx: 0, toPx: 16 } }],
  [3, { width: 1, height: 1 }],
]);
const STREET_ROW = { defId: 1, x: 10, y: 5, floor: 0 };
const PLATFORM_ROW = { defId: 2, x: 19, y: 3, floor: -1 };
const PROP_ROW = { defId: 3, x: 30, y: 30, floor: 0 };

function synthetic(): FlightIndex {
  return new FlightIndex(
    buildFlights(
      TRANSITIONS,
      [STREET_ROW, PLATFORM_ROW, PROP_ROW],
      SOURCES,
      STOREY,
      TILE,
      noStandableFarEnd,
    ),
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
              [1, { width: 3, height: 1, flight: { dropPx: drop, fromPx: 0, toPx: 32 } }],
              [
                2,
                {
                  width: length,
                  height: 2,
                  flight: { dropPx: drop, fromPx: 0, toPx: (length - 1) * TILE },
                },
              ],
            ]),
            STOREY,
            TILE,
            noStandableFarEnd,
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
        TILE,
        noStandableFarEnd,
      ),
    ).toThrow(/two flights/);
    expect(() =>
      buildFlights(
        TRANSITIONS,
        [{ ...STREET_ROW, x: 9 }, PLATFORM_ROW],
        SOURCES,
        STOREY,
        TILE,
        noStandableFarEnd,
      ),
    ).toThrow(/far end/);
  });

  it("has no flight for an anchor no flight object covers", () => {
    expect(buildFlights(TRANSITIONS, [PROP_ROW], SOURCES, STOREY, TILE, noStandableFarEnd)).toEqual(
      [],
    );
  });
});

describe("a flight on any axis (FR182)", () => {
  const AXES = [
    { name: "west", d: { x: -1, y: 0 } },
    { name: "east", d: { x: 1, y: 0 } },
    { name: "south", d: { x: 0, y: 1 } },
    { name: "north", d: { x: 0, y: -1 } },
  ];

  // A street flight of three cells ending at the anchor and a platform
  // flight of two ending at the reverse anchor, along `d` and `-d`.
  function pair(d: { x: number; y: number }) {
    const A = { x: 10, y: 10 };
    const L = { x: 30, y: 30 };
    const R = { x: L.x - d.x, y: L.y - d.y };
    const transitions: TransitionSpec[] = [
      { x: A.x, y: A.y, floor: 0, targetX: L.x, targetY: L.y, targetFloor: -1 },
      { x: R.x, y: R.y, floor: -1, targetX: A.x - d.x, targetY: A.y - d.y, targetFloor: 0 },
    ];
    const row = (far: { x: number; y: number }, toward: { x: number; y: number }, n: number) => {
      const cells = Array.from({ length: n }, (_, k) => ({
        x: far.x + toward.x * k,
        y: far.y + toward.y * k,
      }));
      const xs = cells.map((c) => c.x);
      const ys = cells.map((c) => c.y);
      return {
        x: Math.min(...xs),
        y: Math.max(...ys),
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
      };
    };
    const street = row(A, { x: -d.x, y: -d.y }, 3);
    const platform = row(R, d, 2);
    const placed = [
      { defId: 1, x: street.x, y: street.y, floor: 0 },
      { defId: 2, x: platform.x, y: platform.y, floor: -1 },
    ];
    const sources = new Map([
      [
        1,
        {
          width: street.width,
          height: street.height,
          flight: { dropPx: 8, fromPx: 0, toPx: 32 },
        },
      ],
      [
        2,
        {
          width: platform.width,
          height: platform.height,
          flight: { dropPx: 4, fromPx: 0, toPx: 16 },
        },
      ],
    ]);
    return { A, R, transitions, placed, sources };
  }

  for (const { name, d } of AXES) {
    it(`walking ${name} (from_px 0, to_px at the anchor cell's near edge): zero at the open edge, the signed drop at to_px, flat beyond`, () => {
      const { A, R, transitions, placed, sources } = pair(d);
      const index = new FlightIndex(
        buildFlights(transitions, placed, sources, STOREY, TILE, noStandableFarEnd),
        config,
      );
      // Feet `u` cells from the anchor cell's centre toward the open side.
      const at = (
        anchor: { x: number; y: number },
        toward: { x: number; y: number },
        u: number,
      ) => ({
        x: anchor.x + 0.5 + toward.x * u,
        y: anchor.y + 0.5 + toward.y * u,
      });
      const away = { x: -d.x, y: -d.y };
      const street = (u: number) => {
        const p = at(A, away, u);
        return index.offsetPx(p.x, p.y, 0);
      };
      // The street flight is 3 cells: open edge 2.5 out, near edge 0.5 out.
      expect(street(2.5)).toBe(0);
      expect(street(0.5)).toBe(8);
      expect(street(0)).toBe(8);
      expect(street(1.5)).toBeCloseTo(4, 9);
      const platform = (u: number) => {
        const p = at(R, d, u);
        return index.offsetPx(p.x, p.y, -1);
      };
      // The platform flight is 2 cells: open edge 1.5 out, near edge 0.5 out.
      expect(platform(1.5)).toBe(0);
      expect(platform(0.5)).toBe(-4);
      expect(platform(0)).toBe(-4);
    });
  }
});

describe("flight construction (FR182)", () => {
  it("refuses a ramp that leaves the footprint along the walked axis", () => {
    expect(() =>
      buildFlights(
        TRANSITIONS,
        [STREET_ROW, PLATFORM_ROW],
        new Map([
          [1, { width: 3, height: 1, flight: { dropPx: 8, fromPx: 0, toPx: 49 } }],
          [2, { width: 2, height: 2, flight: { dropPx: 4, fromPx: 0, toPx: 16 } }],
        ]),
        STOREY,
        TILE,
        noStandableFarEnd,
      ),
    ).toThrow(/leaves its footprint/);
  });

  it("is flat before `from`, flat after `to`, and exactly linear between, on both signs", () => {
    const sources = new Map([
      [1, { width: 3, height: 1, flight: { dropPx: 8, fromPx: 8, toPx: 24 } }],
      [2, { width: 2, height: 2, flight: { dropPx: 4, fromPx: 4, toPx: 12 } }],
    ]);
    const index = new FlightIndex(
      buildFlights(
        TRANSITIONS,
        [STREET_ROW, PLATFORM_ROW],
        sources,
        STOREY,
        TILE,
        noStandableFarEnd,
      ),
      config,
    );
    // Street: open edge x = 13, walking west; `px` native pixels from it.
    const street = (px: number) => index.offsetPx(13 - px / TILE, 5.9, 0);
    expect(street(0)).toBe(0);
    expect(street(8)).toBe(0); // the first nosing
    expect(street(16)).toBe(4); // exactly the midpoint
    expect(street(24)).toBe(8); // the last nosing
    expect(street(30)).toBe(8); // flat after, short of the anchor cell's edge
    expect(street(40)).toBe(8);
    // Platform: open edge x = 19, walking east; the drop is negative.
    const platform = (px: number) => index.offsetPx(19 + px / TILE, 2.9, -1);
    expect(platform(0)).toBe(0);
    expect(platform(4)).toBe(0);
    expect(platform(8)).toBe(-2);
    expect(platform(12)).toBe(-4);
    expect(platform(16)).toBe(-4);
  });

  it("refuses a flight shorter than two cells along its axis", () => {
    expect(() =>
      buildFlights(
        TRANSITIONS,
        [{ defId: 1, x: 10, y: 5, floor: 0 }],
        new Map([[1, { width: 1, height: 1, flight: { dropPx: 8, fromPx: 0, toPx: 8 } }]]),
        STOREY,
        TILE,
        noStandableFarEnd,
      ),
    ).toThrow(/shorter than two cells/);
  });

  it("refuses two flights that share a cell, and an index with none is always zero", () => {
    const [flight] = buildFlights(
      TRANSITIONS,
      [STREET_ROW],
      SOURCES,
      STOREY,
      TILE,
      noStandableFarEnd,
    );
    if (!flight) throw new Error("no flight");
    expect(() => new FlightIndex([flight, flight], config)).toThrow(/share cell/);
    expect(new FlightIndex([], config).offsetPx(11, 5.9, 0)).toBe(0);
  });

  it("a flight wider than one cell, anchored in every column, is one flight", () => {
    // Two columns walked north: a pair per column on one two-wide object each side.
    const columns = [30, 31];
    const transitions: TransitionSpec[] = columns.flatMap((x) => [
      { x, y: 10, floor: 0, targetX: x, targetY: 10, targetFloor: 1 },
      { x, y: 11, floor: 1, targetX: x, targetY: 11, targetFloor: 0 },
    ]);
    const sources = new Map([
      [1, { width: 2, height: 2, flight: { dropPx: 24, fromPx: 0, toPx: 16 } }],
      [2, { width: 2, height: 2, flight: { dropPx: 24, fromPx: 0, toPx: 16 } }],
    ]);
    const flights = buildFlights(
      transitions,
      [
        { defId: 1, x: 30, y: 11, floor: 0 },
        { defId: 2, x: 30, y: 11, floor: 1 },
      ],
      sources,
      STOREY,
      TILE,
      noStandableFarEnd,
    );
    expect(flights.every((f) => Object.is(f.dirX, 0))).toBe(true);
    expect(flights.map((f) => [f.floor, f.x0, f.x1, f.y0, f.y1, f.dirY, f.dropPx])).toEqual([
      [0, 30, 32, 10, 12, -1, -24],
      [1, 30, 32, 10, 12, 1, 24],
    ]);
  });

  it("a wide flight's anchors must all resolve the same flight, and every standable far-end cell is anchored", () => {
    const sources = new Map([
      [1, { width: 2, height: 2, flight: { dropPx: 24, fromPx: 0, toPx: 16 } }],
      [2, { width: 2, height: 2, flight: { dropPx: 24, fromPx: 0, toPx: 16 } }],
    ]);
    const rows = [
      { defId: 1, x: 30, y: 11, floor: 0 },
      { defId: 2, x: 30, y: 11, floor: 1 },
    ];
    const pair = (x: number, y: number, ry: number): TransitionSpec[] => [
      { x, y, floor: 0, targetX: x, targetY: y, targetFloor: 1 },
      { x, y: ry, floor: 1, targetX: x, targetY: ry, targetFloor: 0 },
    ];
    // (a) a second-column anchor that is not at the far end is refused.
    expect(() =>
      buildFlights(
        [...pair(30, 10, 11), ...pair(31, 11, 10)],
        rows,
        sources,
        STOREY,
        TILE,
        noStandableFarEnd,
      ),
    ).toThrow(/far end|differently/);
    // (b) two columns whose pairings walk opposite ways disagree: refused, naming both anchors.
    const southward: TransitionSpec[] = [
      { x: 31, y: 11, floor: 0, targetX: 31, targetY: 11, targetFloor: 1 },
      { x: 31, y: 10, floor: 1, targetX: 31, targetY: 10, targetFloor: 0 },
    ];
    expect(() =>
      buildFlights(
        [...pair(30, 10, 11), ...southward],
        rows,
        sources,
        STOREY,
        TILE,
        noStandableFarEnd,
      ),
    ).toThrow(/anchors \(30, 10, floor 0\) and \(31, 11, floor 0\).*differently/);
    // (d) two columns that climb to different floors disagree even when the offset's sign
    // is the same: refused, naming both anchors.
    const toSecond: TransitionSpec[] = [
      { x: 31, y: 10, floor: 0, targetX: 31, targetY: 10, targetFloor: 2 },
      { x: 31, y: 11, floor: 2, targetX: 31, targetY: 11, targetFloor: 0 },
    ];
    expect(() =>
      buildFlights([...pair(30, 10, 11), ...toSecond], rows, sources, STOREY, TILE, () => false),
    ).toThrow(/anchors \(30, 10, floor 0\) and \(31, 10, floor 0\).*differently/);
    // (c) a standable far-end cell with no anchor is refused, naming the cell and the row; a
    // cell no body can stand in needs none.
    expect(() => buildFlights(pair(30, 10, 11), rows, sources, STOREY, TILE, () => true)).toThrow(
      /row \(30, 11, floor 0\).*far-end cell \(31, 10\)/,
    );
    expect(
      buildFlights(pair(30, 10, 11), rows, sources, STOREY, TILE, (x) => x === 30).length,
    ).toBe(2);
    // Anchored in both columns, it is one flight with a +0 axis, never -0.
    const [street] = buildFlights(
      [...pair(30, 10, 11), ...pair(31, 10, 11)],
      rows,
      sources,
      STOREY,
      TILE,
      () => true,
    );
    expect(Object.is(street?.dirX, 0)).toBe(true);
  });

  it("ignores a placed row whose def declares no drop, or has no def", () => {
    const rows = [PROP_ROW, { defId: 99, x: 10, y: 5, floor: 0 }];
    expect(buildFlights(TRANSITIONS, rows, SOURCES, STOREY, TILE, noStandableFarEnd)).toEqual([]);
  });

  it("gives a transition that changes no floor offset a zero drop", () => {
    const flat: TransitionSpec[] = [
      { x: 10, y: 5, floor: 0, targetX: 19, targetY: 2, targetFloor: 0 },
      { x: 20, y: 2, floor: 0, targetX: 11, targetY: 5, targetFloor: 0 },
    ];
    const flights = buildFlights(flat, [STREET_ROW], SOURCES, STOREY, TILE, noStandableFarEnd);
    expect(flights.map((f) => f.dropPx)).toEqual([0]);
    expect(Object.is(flights[0]?.dropPx, 0)).toBe(true);
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
    TILE,
    streetStandable,
  );

  const coversAnchor = (f: (typeof flights)[number], a: TransitionSpec) =>
    f.floor === a.floor && a.x >= f.x0 && a.x < f.x1 && a.y >= f.y0 && a.y < f.y1;

  it("every anchor of every pairing resolves exactly one flight, by floor and by the fixture's own constants", () => {
    // The subway's two, and the footbridge's: one flight on the street, one on the deck.
    expect(flights.map((f) => f.floor).sort()).toEqual([SUBWAY_FLOOR, 0, 0, BRIDGE_FLOOR]);
    const bridgeStreet = flights.find((f) => f.floor === 0 && f.x0 === BRIDGE_FLIGHT_X0);
    const bridgeDeck = flights.find((f) => f.floor === BRIDGE_FLOOR);
    if (!bridgeStreet || !bridgeDeck) throw new Error("the footbridge has no flight on a floor");
    for (const f of [bridgeStreet, bridgeDeck]) {
      expect(f.x1 - f.x0).toBe(BRIDGE_FLIGHT_WIDTH);
      expect(f.x0).toBe(BRIDGE_FLIGHT_X0);
      expect(f.y1 - f.y0).toBe(BRIDGE_FLIGHT_DEPTH);
      expect(f.y0).toBe(BRIDGE_UP_ANCHOR_Y);
      // Walked along the drawn axis (north up, south down), never across it.
      expect(f.dirX).toBe(0);
    }
    expect(bridgeStreet.dirY).toBe(-1);
    expect(bridgeDeck.dirY).toBe(1);
    const { pairings, unpaired } = pairTransitions(STREET_TRANSITIONS);
    expect(unpaired).toEqual([]);
    for (const { forward, reverse } of pairings) {
      for (const anchor of [forward, reverse]) {
        expect(
          flights.filter((f) => coversAnchor(f, anchor)).length,
          `anchor (${anchor.x}, ${anchor.y}, floor ${anchor.floor}) must resolve exactly one flight`,
        ).toBe(1);
      }
    }
  });

  it("takes each drop from the declared art, signed toward the target floor", () => {
    const declared = new Map(
      defs.objects.filter((o) => o.flight !== undefined).map((o) => [o.key, o.flight?.dropPx]),
    );
    expect([...declared.keys()].sort()).toEqual([
      "bridge_stairs_deck",
      "bridge_stairs_street",
      "platform_stair_flight",
      "stairwell_treads",
    ]);
    const onStreet = flights.filter((f) => f.floor === 0);
    expect(onStreet.map((f) => f.dropPx).sort((a, b) => a - b)).toEqual(
      [
        declared.get("stairwell_treads") as number,
        -(declared.get("bridge_stairs_street") as number),
      ].sort((a, b) => a - b),
    );
    expect(flights.find((f) => f.floor === SUBWAY_FLOOR)?.dropPx).toBe(
      -(declared.get("platform_stair_flight") as number),
    );
    expect(flights.find((f) => f.floor === BRIDGE_FLOOR)?.dropPx).toBe(
      declared.get("bridge_stairs_deck"),
    );
  });

  it("a positive storey difference gives the offset the right screen direction on both sides of the pair", () => {
    // The deck is above the street: climbing is up the screen on the street
    // side (negative) and the deck side is the way back down (positive).
    const index = new FlightIndex(flights, config);
    const { pairings } = pairTransitions(STREET_TRANSITIONS);
    const bridge = pairings.filter(
      (p) => p.forward.floor === BRIDGE_FLOOR || p.reverse.floor === BRIDGE_FLOOR,
    );
    expect(bridge.length).toBe(BRIDGE_FLIGHT_WIDTH);
    for (const { forward, reverse } of bridge) {
      const [up, down] =
        forward.targetFloor > forward.floor ? [forward, reverse] : [reverse, forward];
      expect(floorOffsetPx(up.targetFloor, STOREY)).toBeLessThan(floorOffsetPx(up.floor, STOREY));
      // Entering the anchor cell of each side, from its open neighbour.
      const entry = (a: TransitionSpec, dirY: number) =>
        index.offsetPx(a.x + 0.5, dirY > 0 ? a.y + 0.001 : a.y + 0.999, a.floor);
      expect(entry(up, -1), "toward a higher floor: up the screen").toBeLessThan(0);
      expect(entry(down, 1), "toward a lower floor: down the screen").toBeGreaterThan(0);
      for (const f of flights.filter((f) => coversAnchor(f, up))) {
        expect(Math.sign(f.dropPx)).toBe(Math.sign(floorOffsetPx(up.targetFloor, STOREY)));
      }
      for (const f of flights.filter((f) => coversAnchor(f, down))) {
        expect(Math.sign(f.dropPx)).toBe(-Math.sign(floorOffsetPx(up.targetFloor, STOREY)));
      }
    }
  });

  it("at every floor change, the two sides' offsets and the jump account for the whole storey", () => {
    const index = new FlightIndex(flights, config);
    const { pairings } = pairTransitions(STREET_TRANSITIONS);
    for (const { forward, reverse, d } of pairings) {
      // Walking `+d` into `forward` and `-d` into `reverse`.
      for (const [from, dir] of [
        [forward, d],
        [reverse, { x: -d.x, y: -d.y }],
      ] as const) {
        const at = {
          x: from.x + 0.5 - dir.x * 0.5 + dir.x * 0.001,
          y: from.y + 0.5 - dir.y * 0.5 + dir.y * 0.001,
        };
        const entry = index.offsetPx(at.x, at.y, from.floor);
        // A transition onto its own cell keeps the walker's position.
        const sameCell = from.targetX === from.x && from.targetY === from.y;
        const landing = sameCell
          ? index.offsetPx(at.x, at.y, from.targetFloor)
          : index.offsetPx(from.targetX + 0.5, from.targetY + 0.5, from.targetFloor);
        const floorStep =
          floorOffsetPx(from.targetFloor, STOREY) - floorOffsetPx(from.floor, STOREY);
        const jump = floorStep + (landing - entry);
        // The flights show part of the storey; the rest is the cut.
        expect(Math.abs(floorStep)).toBe(STOREY);
        expect(Math.abs(jump)).toBeCloseTo(STOREY - Math.abs(entry) - Math.abs(landing), 9);
        expect(Math.sign(jump) === Math.sign(floorStep) || jump === 0).toBe(true);
      }
    }
  });

  it("the footbridge's floor change moves the drawn height by nothing, at the position the walker has, in both directions", () => {
    const index = new FlightIndex(flights, config);
    const { pairings } = pairTransitions(STREET_TRANSITIONS);
    const bridge = pairings.filter(
      (p) => p.forward.floor === BRIDGE_FLOOR || p.reverse.floor === BRIDGE_FLOOR,
    );
    for (const { forward, reverse, d } of bridge) {
      for (const [from, dir] of [
        [forward, d],
        [reverse, { x: -d.x, y: -d.y }],
      ] as const) {
        const at = {
          x: from.x + 0.5 - dir.x * 0.5 + dir.x * 0.001,
          y: from.y + 0.5 - dir.y * 0.5 + dir.y * 0.001,
        };
        const entry = index.offsetPx(at.x, at.y, from.floor);
        // A transition onto its own cell keeps the walker's position.
        const sameCell = from.targetX === from.x && from.targetY === from.y;
        const landing = sameCell
          ? index.offsetPx(at.x, at.y, from.targetFloor)
          : index.offsetPx(from.targetX + 0.5, from.targetY + 0.5, from.targetFloor);
        // The whole storey is shown by the two flights, so the floor change takes none of it:
        // the drawn height (floor offset plus flight offset) is the same either side.
        expect(sameCell, "the footbridge's transitions land on their own cell").toBe(true);
        const jump =
          floorOffsetPx(from.targetFloor, STOREY) -
          floorOffsetPx(from.floor, STOREY) +
          (landing - entry);
        // (The entry point is a thousandth of a cell inside the anchor: a few hundredths of a px.)
        expect(Math.abs(jump)).toBeLessThan(0.05);
      }
    }
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

  // CI worst case under coverage: 1.19 s (run 37229489003); the exhaustive scan of every sub-cell is the property under test (already one pass per grid), so the work
  // cannot shrink. 60 s is over 10x that.
  const EXHAUSTIVE_SCAN_TIMEOUT_MS = 60_000;
  it("no two adjacent standable feet positions differ by more than the steepest slope (never off the surface), on every floor", {
    timeout: EXHAUSTIVE_SCAN_TIMEOUT_MS,
  }, () => {
    const index = new FlightIndex(flights, config);
    const world = streetWorldIndex();
    const sub = config.subcellsPerCell;
    const slope = Math.max(
      ...flights.map((f) => Math.abs(f.dropPx) / ((f.fullS - f.startS) * sub)),
    );
    // The floors and the grid are the fixture's own: a fourth floor or a
    // wider street cannot fall outside the sweep.
    const floors = fixtureFloors();
    expect(floors).toEqual([SUBWAY_FLOOR, 0, BRIDGE_FLOOR]);
    const { widthCells, heightCells } = fixtureExtent();
    const w = widthCells * sub;
    const h = heightCells * sub;
    const nonZero = new Map<number, number>(floors.map((f) => [f, 0]));
    let pairs = 0;
    for (const floor of floors) {
      // Each position's clearance and offset once, then compare neighbours.
      const clear = new Uint8Array(w * h);
      const offset = new Float64Array(w * h);
      for (let cx = 0; cx < w; cx++) {
        for (let feet = 0; feet < h; feet++) {
          if (!isBodyClear(world, config, floor, cx, feet)) continue;
          clear[cx * h + feet] = 1;
          offset[cx * h + feet] = index.offsetPx(cx / sub, feet / sub, floor);
        }
      }
      for (let cx = 0; cx < w; cx++) {
        for (let feet = 0; feet < h; feet++) {
          const i = cx * h + feet;
          if (!clear[i]) continue;
          const here = offset[i];
          if (here !== 0) nonZero.set(floor, (nonZero.get(floor) ?? 0) + 1);
          for (const [nx, ny] of [
            [cx + 1, feet],
            [cx, feet + 1],
          ] as const) {
            // Neighbours past the grid edge are computed directly (a thin border).
            const inside = nx < w && ny < h;
            if (inside ? !clear[nx * h + ny] : !isBodyClear(world, config, floor, nx, ny)) continue;
            pairs++;
            const there = inside ? offset[nx * h + ny] : index.offsetPx(nx / sub, ny / sub, floor);
            if (Math.abs(there - here) > slope + 1e-9) {
              throw new Error(
                `floor ${floor}: (${cx}, ${feet}) -> (${nx}, ${ny}) jumps ${there - here} sub-cell units`,
              );
            }
          }
        }
      }
    }
    // The exhaustive scan compares exactly this many adjacent pairs. The count
    // changes with the street fixture; re-pin it from the loop's own `pairs`.
    expect(pairs).toBe(399359);
    for (const floor of floors) {
      expect(
        nonZero.get(floor),
        `the sweep never reached a flight on floor ${floor}`,
      ).toBeGreaterThan(0);
    }
  });
});

// FR182: the floor offset is taken at the floor change, and nowhere else. A
// real walk (the resolver and grid the browser runs) up onto the deck, back
// halfway, up again, then all the way down, tracking the whole drawn height:
// the floor offset plus the flight offset.
describe("the footbridge flights: the walker is drawn continuously across the floor change (FR182)", () => {
  const defs = committedDefs();
  const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
  const flights = buildFlights(
    STREET_TRANSITIONS,
    streetPlacedRows(),
    streetObjectSources(),
    storey,
    TILE,
    streetStandable,
  );
  const index = new FlightIndex(flights, config);
  const world = streetWorldIndex();
  const transitions = streetTransitionIndex();
  const { pairings } = pairTransitions(STREET_TRANSITIONS);
  const bridge = pairings.filter(
    (p) => p.forward.floor === BRIDGE_FLOOR || p.reverse.floor === BRIDGE_FLOOR,
  );
  const perTickPx = config.walkSpeedCellsPerMs * 16 * TILE;
  // The most the drawn feet (world y, plus the floor offset, plus the flight
  // offset) move in one tick: the walk itself, and the flight's slope on it.
  const slopePerPx = Math.max(
    ...flights.map((f) => Math.abs(f.dropPx) / ((f.fullS - f.startS) * TILE)),
  );
  const tickBoundPx = perTickPx * (1 + slopePerPx);
  const covers = (f: (typeof flights)[number], a: TransitionSpec) =>
    f.floor === a.floor && a.x >= f.x0 && a.x < f.x1 && a.y >= f.y0 && a.y < f.y1;

  it("the footbridge is a pair per column of its flight", () => {
    expect(bridge.length).toBe(BRIDGE_FLIGHT_WIDTH);
  });

  for (const pairing of bridge) {
    // The street side is the one whose anchor is on the street floor.
    const up = pairing.forward.floor === 0 ? pairing.forward : pairing.reverse;
    const down = up === pairing.forward ? pairing.reverse : pairing.forward;
    const climb = up === pairing.forward ? pairing.d : { x: -pairing.d.x, y: -pairing.d.y };

    it(`column ${up.x}: up onto the deck, a reversal halfway, then all the way down`, () => {
      const streetFlight = flights.find((f) => covers(f, up));
      const deckFlight = flights.find((f) => covers(f, down));
      if (!streetFlight || !deckFlight) throw new Error("the pair has no flight on a side");
      // The flight is walked along y: `climb.y` is -1 when climbing goes north.
      const north = climb.y < 0;
      const streetOpenY = north ? streetFlight.y1 : streetFlight.y0;
      const deckOpenY = north ? deckFlight.y0 : deckFlight.y1;
      // `toward(y, edge)`: y is at or beyond `edge` in the climbing direction.
      const beyond = (y: number, edge: number) => (north ? y <= edge : y >= edge);
      let state = {
        ...initialFloorWalkState(up.x + 0.5, streetOpenY - climb.y * 0.4, 0),
        transitioned: false,
      };
      const samples: { drawn: number; floor: number; transitioned: boolean }[] = [
        {
          drawn: state.y * TILE + index.offsetPx(state.x, state.y, state.floor),
          floor: 0,
          transitioned: false,
        },
      ];
      const walk = (dy: number, until: (s: typeof state) => boolean) => {
        for (let i = 0; i < 4000; i++) {
          state = stepAndTransition(state, { x: 0, y: dy }, 16, world, config, transitions);
          samples.push({
            drawn:
              state.y * TILE +
              floorOffsetPx(state.floor, STOREY) +
              index.offsetPx(state.x, state.y, state.floor),
            floor: state.floor,
            transitioned: state.transitioned,
          });
          if (until(state)) return;
        }
        throw new Error("walk did not finish");
      };
      const atOpenEdge = (s: typeof state) => !beyond(s.y, streetOpenY - climb.y * 0.3);
      // Up halfway along the street half, back to its open edge, then up and over.
      walk(climb.y, (s) => beyond(s.y, streetOpenY + climb.y * 0.5));
      walk(-climb.y, atOpenEdge);
      walk(climb.y, (s) => s.floor === BRIDGE_FLOOR);
      // Along the deck half toward the deck, a reversal, then all the way down.
      walk(climb.y, (s) => beyond(s.y, deckOpenY - climb.y * 0.25));
      walk(-climb.y, (s) => s.floor === 0);
      walk(-climb.y, atOpenEdge);

      // On every tick, the floor changes included, the drawn feet move no more
      // than one tick of walking allows on the steepest slope.
      let cuts = 0;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        if (!a || !b) continue;
        if (b.transitioned) cuts++;
        expect(Math.abs(b.drawn - a.drawn), `tick ${i}`).toBeLessThanOrEqual(tickBoundPx + 1e-9);
      }
      // Up, and down again: two floor changes, neither a hop.
      expect(cuts).toBe(2);
      // Up the flight, the walk is drawn well above the street.
      expect(samples.some((s) => s.floor === BRIDGE_FLOOR)).toBe(true);
      expect((samples[0]?.drawn ?? 0) - Math.min(...samples.map((s) => s.drawn))).toBeGreaterThan(
        STOREY / 2,
      );
    });
  }
});

// The nosings, measured from the art (Artie): the sprite-relative x of each
// tread's centre and the sheet row of its top. A flight's declared ramp must
// run through them -- a wrong `flight` table, or a new flight sheet, fails here by name.
const NOSINGS: Record<string, { fromOpenEdge: "east" | "west"; xs: number[]; rows: number[] }> = {
  stairwell_treads: {
    fromOpenEdge: "east",
    xs: [43, 36, 28.5, 21, 14],
    rows: [32, 34, 36, 38, 40],
  },
  platform_stair_flight: {
    fromOpenEdge: "west",
    xs: [5.5, 13.5, 21.5, 29],
    rows: [17, 16, 15, 14],
  },
};

// The footbridge's flights are undrawn (walk data): its staircase is drawn once,
// on the street floor, as placed rows of two crops, seen front-on. Treads are
// stacked on screen, so a tread's nosing is a sprite row: `risers` are the
// sprite-relative rows of the dark riser lines, measured from the sheet by
// Artie, `pitch` the rows from one to the next.
const FRONT_ON: Record<string, { pitch: number; risers: number[] }> = {
  bridge_stairs_tread: { pitch: 8, risers: [6, 14] },
  bridge_stairs_abutment: { pitch: 8, risers: [6, 14] },
};
/** The flights that are walk data only: their nosings are the drawn tread rows over their footprint. */
const UNDRAWN_FLIGHTS = ["bridge_stairs_street", "bridge_stairs_deck"];

describe("a flight's ramp follows the drawn nosings (FR182)", () => {
  const defs = committedDefs();
  const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
  const flights = buildFlights(
    STREET_TRANSITIONS,
    streetPlacedRows(),
    streetObjectSources(),
    storey,
    TILE,
    streetStandable,
  );
  const index = new FlightIndex(flights, config);

  it("every def that declares a flight has a nosing line to be checked against", () => {
    const missing = defs.objects
      .filter(
        (o) => o.flight !== undefined && !(o.key in NOSINGS) && !UNDRAWN_FLIGHTS.includes(o.key),
      )
      .map((o) => o.key);
    expect(missing, `flight defs with no NOSINGS entry: ${missing.join(", ")}`).toEqual([]);
  });

  for (const [key, nosing] of Object.entries(NOSINGS)) {
    it(`${key}: the offset at every walkable point is within 1 native px of the nosing line`, () => {
      const object = defs.objects.find((o) => o.key === key);
      const row = streetPlacedRows().find((r) => r.defId === object?.id);
      if (!object?.sprite || !row) throw new Error(`no ${key}`);
      const flight = flights.find(
        (f) => f.floor === row.floor && row.x >= f.x0 && row.x < f.x1 && f.y1 - 1 === row.y,
      );
      if (!flight) throw new Error(`no flight for ${key}`);
      // Nosing line: tops step by (row - firstRow) over the tread centres.
      const open = nosing.fromOpenEdge === "east" ? object.sprite.w : 0;
      const sign = Math.sign(flight.dropPx);
      const nosingOffset = (distFromOpenEdge: number): number => {
        const dists = nosing.xs.map((x) => Math.abs(x - open));
        const first = dists[0] ?? 0;
        const last = dists[dists.length - 1] ?? 0;
        const total = Math.abs((nosing.rows[nosing.rows.length - 1] ?? 0) - (nosing.rows[0] ?? 0));
        const t = Math.min(1, Math.max(0, (distFromOpenEdge - first) / (last - first)));
        return sign * total * t;
      };
      // The declared ramp is the nosing line: the drop is the rows' span and
      // the ramp starts and ends on the first and last tread.
      expect(Math.abs(flight.dropPx)).toBe(
        Math.abs((nosing.rows[nosing.rows.length - 1] ?? 0) - (nosing.rows[0] ?? 0)),
      );
      const widthPx = object.sprite.w;
      for (let px = 0; px <= widthPx; px += 0.5) {
        // Feet at `px` native pixels from the open edge, along the axis.
        // The footprint's low edge on the walking axis (`s = x * dirX + y * dirY`).
        const lo =
          flight.dirX !== 0
            ? flight.dirX > 0
              ? flight.x0
              : -flight.x1
            : flight.dirY > 0
              ? flight.y0
              : -flight.y1;
        const s = lo + px / TILE;
        const x = flight.dirX !== 0 ? s * flight.dirX : flight.x0 + 0.5;
        const y = flight.dirY !== 0 ? s * flight.dirY : flight.y1 - 0.1;
        const got = index.offsetPx(x, y, flight.floor);
        expect(Math.abs(got - nosingOffset(px)), `${key} at ${px} px`).toBeLessThanOrEqual(1);
      }
    });
  }

  for (const [key, art] of Object.entries(FRONT_ON)) {
    it(`${key}: the art repeats every tread, a dark riser line each`, () => {
      const object = defs.objects.find((o) => o.key === key);
      if (!object?.sprite) throw new Error(`no ${key}`);
      const { sprite } = object;
      const root = fileURLToPath(new URL("../../../../", import.meta.url));
      const png = PNG.sync.read(readFileSync(`${root}${sprite.sheet}`));
      const px = (x: number, y: number, k: number) =>
        png.data[((sprite.y + y) * png.width + sprite.x + x) * 4 + k] ?? 0;
      const luma = (y: number) => px(16, y, 0) + px(16, y, 1) + px(16, y, 2);
      for (const riser of art.risers) {
        expect(luma(riser), `row ${riser} is a riser line`).toBeLessThan(luma(riser - 1));
      }
      art.risers.forEach((riser, i) => {
        expect(riser - (art.risers[0] ?? 0)).toBe(i * art.pitch);
      });
      // The art repeats at the pitch over the whole crop.
      for (let y = 0; y + art.pitch < sprite.h; y++) {
        for (let x = 0; x < sprite.w; x++) {
          for (let k = 0; k < 4; k++) {
            expect(px(x, y + art.pitch, k), `row ${y + art.pitch} repeats row ${y}`).toBe(
              px(x, y, k),
            );
          }
        }
      }
    });
  }

  // The oracle is the art as drawn, never the ramp formula: the riser rows of
  // every placed piece of the staircase, placed where each sprite is drawn on
  // screen (its footprint's south edge and its floor's storey offset). The
  // feet's drawn y is the world y in px plus the floor offset plus the flight
  // offset.
  it("the undrawn flights' surfaces meet the drawn staircase: a riser line every 8 px from the foot to the deck, the foot on the stack's bottom, the stack's top on the deck tile, both surfaces at the floor change, each on a tread boundary", () => {
    const rows = streetPlacedRows();
    const objectOf = (id: number) => defs.objects.find((o) => o.id === id);
    const pieces = rows.flatMap((r) => {
      const object = objectOf(r.defId);
      const art = object ? FRONT_ON[object.key] : undefined;
      if (!object?.sprite || !art) return [];
      const top = (r.y + 1) * TILE - object.sprite.h + floorOffsetPx(r.floor, storey);
      return [
        { row: r, top, bottom: top + object.sprite.h, risers: art.risers.map((i) => top + i) },
      ];
    });
    expect(pieces.length, "the staircase is drawn").toBeGreaterThan(0);
    const feet = (x: number, y: number, floor: number) =>
      y * TILE + floorOffsetPx(floor, storey) + index.offsetPx(x, y, floor);
    // Every riser line, foot to deck: one every 8 px, no tall tread.
    const risers = pieces.flatMap((p) => p.risers).sort((a, b) => a - b);
    for (let i = 1; i < risers.length; i++) {
      expect((risers[i] ?? 0) - (risers[i - 1] ?? 0), `riser ${i}`).toBe(8);
    }
    const stackTop = Math.min(...pieces.map((p) => p.top));
    const stackBottom = Math.max(...pieces.map((p) => p.bottom));
    const streetFlight = flights.find((f) => f.floor === STREET_FLOOR && f.dirY < 0);
    const deckFlight = flights.find((f) => f.floor === BRIDGE_FLOOR);
    if (!streetFlight || !deckFlight) throw new Error("the footbridge has no flights");
    const x = streetFlight.x0 + 0.5;
    const eps = 1e-4;
    // The foot: the walker stands on the stack's bottom edge at the open edge.
    expect(
      Math.abs(feet(x, streetFlight.y1 - eps, STREET_FLOOR) - stackBottom),
      "the foot on the stack's bottom",
    ).toBeLessThanOrEqual(1);
    // The head: at its open edge the deck flight meets the bottom of the deck tile above it,
    // which is the top of the stack.
    const deckTile = rows.find(
      (r) =>
        r.defId === BRIDGE_DECK_DEF_ID && r.floor === deckFlight.floor && r.y === deckFlight.y0 - 1,
    );
    if (!deckTile) throw new Error("no deck tile above the deck flight");
    const deckTileBottom = (deckTile.y + 1) * TILE + floorOffsetPx(deckTile.floor, storey);
    expect(
      Math.abs(feet(x, deckFlight.y0 + eps, deckFlight.floor) - deckTileBottom),
      "the deck flight's head on the deck tile",
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(stackTop - deckTileBottom),
      "the stack's top on the deck tile",
    ).toBeLessThanOrEqual(1);
    // The floor change: both surfaces are at one height where the walker crosses.
    const cut = streetFlight.y0 + 1 - eps;
    expect(
      Math.abs(feet(x, cut, streetFlight.floor) - feet(x, cut, deckFlight.floor)),
      "the two flights' surfaces at the floor change",
    ).toBeLessThanOrEqual(1);
    // Each of those heights is the stack's top or a tread boundary: the row
    // after a riser line and its lip.
    const boundaries = [stackTop, ...risers.map((r) => r + 2)];
    for (const [label, height] of [
      ["foot", feet(x, streetFlight.y1 - eps, STREET_FLOOR)],
      ["floor change", feet(x, cut, streetFlight.floor)],
      ["head", feet(x, deckFlight.y0 + eps, deckFlight.floor)],
    ] as const) {
      const off = Math.min(...boundaries.map((b) => Math.abs(b - height)));
      expect(off, `${label}: feet at ${height}`).toBeLessThanOrEqual(1);
    }
  });

  it("the platform flight's drawn top rows step by the declared drop", () => {
    const object = defs.objects.find((o) => o.key === "platform_stair_flight");
    if (!object?.sprite) throw new Error("no platform_stair_flight");
    const { sprite } = object;
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const png = PNG.sync.read(readFileSync(`${root}${sprite.sheet}`));
    const top = (x: number): number => {
      for (let y = 0; y < sprite.h; y++) {
        const a = png.data[((sprite.y + y) * png.width + sprite.x + x) * 4 + 3] ?? 0;
        if (a > 0) return y;
      }
      return -1;
    };
    const first = top(0);
    const last = top(sprite.w - 1);
    expect(first - last).toBe(object.flight?.dropPx);
  });
});

// FR124: floor N+1 is drawn after all of floor N, so an actor on a flight must
// never rise into art of a higher floor. For every standable position on every
// flight, the actor's drawn rect (the character's 16x32 cell, bottom-anchored
// on its drawn feet) overlaps no drawn drawable of any higher floor.
describe("no actor on a flight is drawn under a higher floor (FR124)", () => {
  const defs = committedDefs();
  const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
  const flights = buildFlights(
    STREET_TRANSITIONS,
    streetPlacedRows(),
    streetObjectSources(),
    storey,
    TILE,
    streetStandable,
  );
  const index = new FlightIndex(flights, config);
  const world = streetWorldIndex();
  const sub = config.subcellsPerCell;
  /** `defs/appearance/layouts.toml`'s character cell, native px. */
  const ACTOR = { width: 16, height: 32 };

  /** Every drawn drawable's screen rect (native px): a def's sprite, bottom-anchored on its
   * footprint's south edge, or an asset prop's footprint cells. */
  const drawn = STREET_PROPS.flatMap((prop) => {
    const floorOffset = floorOffsetPx(prop.floor, storey);
    if (isDefStreetProp(prop)) {
      const sprite = defs.objects.find((o) => o.id === prop.defId)?.sprite;
      if (!sprite) return []; // an undrawn flight
      const bottom = (prop.y + 1) * TILE + floorOffset;
      return [
        {
          floor: prop.floor,
          x0: prop.x * TILE,
          x1: prop.x * TILE + sprite.w,
          y0: bottom - sprite.h,
          y1: bottom,
        },
      ];
    }
    const { width, height } = prop.footprint ?? { width: 1, height: 1 };
    const bottom = (prop.y + 1) * TILE + floorOffset;
    return [
      {
        floor: prop.floor,
        x0: prop.x * TILE,
        x1: (prop.x + width) * TILE,
        y0: bottom - height * TILE,
        y1: bottom,
      },
    ];
  });

  it("every standable position on every flight, at every floor below a drawn drawable", () => {
    let positions = 0;
    // Below the street the floors above are culled (FR122), so only street-side flights count.
    for (const flight of flights.filter((f) => f.floor >= STREET_FLOOR)) {
      const above = drawn.filter((d) => d.floor > flight.floor);
      for (let cx = flight.x0 * sub; cx <= flight.x1 * sub; cx++) {
        for (let feet = flight.y0 * sub; feet <= flight.y1 * sub; feet++) {
          if (!isBodyClear(world, config, flight.floor, cx, feet)) continue;
          const x = cx / sub;
          const y = feet / sub;
          // An anchor cell is where the actor changes floor: it is never stood in on this one.
          if (
            STREET_TRANSITIONS.some(
              (t) => t.floor === flight.floor && t.x === Math.floor(x) && t.y === Math.floor(y),
            )
          ) {
            continue;
          }
          const bottom =
            y * TILE + floorOffsetPx(flight.floor, storey) + index.offsetPx(x, y, flight.floor);
          const rect = {
            x0: x * TILE - ACTOR.width / 2,
            x1: x * TILE + ACTOR.width / 2,
            y0: bottom - ACTOR.height,
            y1: bottom,
          };
          positions++;
          for (const d of above) {
            const overlaps = rect.x0 < d.x1 && d.x0 < rect.x1 && rect.y0 < d.y1 && d.y0 < rect.y1;
            expect(
              overlaps,
              `an actor at (${x}, ${y}) on floor ${flight.floor} is drawn under a floor-${d.floor} drawable at x ${d.x0}..${d.x1}, y ${d.y0}..${d.y1}`,
            ).toBe(false);
          }
        }
      }
    }
    expect(positions, "the guard examined positions").toBeGreaterThan(0);
  });
});
