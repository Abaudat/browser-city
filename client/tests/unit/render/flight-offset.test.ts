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
import { snapToScreenPx, worldPointPx } from "../../../src/render/screen-position";
import {
  BRIDGE_DOWN_ANCHOR_X,
  BRIDGE_DOWN_ANCHOR_Y,
  BRIDGE_FLOOR,
  BRIDGE_UP_ANCHOR_X,
  BRIDGE_UP_ANCHOR_Y,
  STAIRS_X,
  STAIRS_Y,
  STREET_TRANSITIONS,
  SUBWAY_FLOOR,
  streetPlacedRows,
} from "../../../src/test-street/fixture";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import { bodyRect, type MovementConfig } from "../../../src/world/movement";
import { pairTransitions, type TransitionSpec } from "../../../src/world/transitions";
import {
  committedDefs,
  isBodyClear,
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
  [1, { width: 3, height: 1, flight: { dropPx: 8, fromPx: 0, toPx: 32 } }],
  [2, { width: 2, height: 2, flight: { dropPx: 4, fromPx: 0, toPx: 16 } }],
  [3, { width: 1, height: 1 }],
]);
const STREET_ROW = { defId: 1, x: 10, y: 5, floor: 0 };
const PLATFORM_ROW = { defId: 2, x: 19, y: 3, floor: -1 };
const PROP_ROW = { defId: 3, x: 30, y: 30, floor: 0 };

function synthetic(): FlightIndex {
  return new FlightIndex(
    buildFlights(TRANSITIONS, [STREET_ROW, PLATFORM_ROW, PROP_ROW], SOURCES, STOREY, TILE),
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
      ),
    ).toThrow(/two flights/);
    expect(() =>
      buildFlights(TRANSITIONS, [{ ...STREET_ROW, x: 9 }, PLATFORM_ROW], SOURCES, STOREY, TILE),
    ).toThrow(/far end/);
  });

  it("has no flight for an anchor no flight object covers", () => {
    expect(buildFlights(TRANSITIONS, [PROP_ROW], SOURCES, STOREY, TILE)).toEqual([]);
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
        buildFlights(transitions, placed, sources, STOREY, TILE),
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
      ),
    ).toThrow(/leaves its footprint/);
  });

  it("is flat before `from`, flat after `to`, and exactly linear between, on both signs", () => {
    const sources = new Map([
      [1, { width: 3, height: 1, flight: { dropPx: 8, fromPx: 8, toPx: 24 } }],
      [2, { width: 2, height: 2, flight: { dropPx: 4, fromPx: 4, toPx: 12 } }],
    ]);
    const index = new FlightIndex(
      buildFlights(TRANSITIONS, [STREET_ROW, PLATFORM_ROW], sources, STOREY, TILE),
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
      ),
    ).toThrow(/shorter than two cells/);
  });

  it("refuses two flights that share a cell, and an index with none is always zero", () => {
    const [flight] = buildFlights(TRANSITIONS, [STREET_ROW], SOURCES, STOREY, TILE);
    if (!flight) throw new Error("no flight");
    expect(() => new FlightIndex([flight, flight], config)).toThrow(/share cell/);
    expect(new FlightIndex([], config).offsetPx(11, 5.9, 0)).toBe(0);
  });

  it("ignores a placed row whose def declares no drop, or has no def", () => {
    const rows = [PROP_ROW, { defId: 99, x: 10, y: 5, floor: 0 }];
    expect(buildFlights(TRANSITIONS, rows, SOURCES, STOREY, TILE)).toEqual([]);
  });

  it("gives a transition that changes no floor offset a zero drop", () => {
    const flat: TransitionSpec[] = [
      { x: 10, y: 5, floor: 0, targetX: 19, targetY: 2, targetFloor: 0 },
      { x: 20, y: 2, floor: 0, targetX: 11, targetY: 5, targetFloor: 0 },
    ];
    const flights = buildFlights(flat, [STREET_ROW], SOURCES, STOREY, TILE);
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
  );

  it("both subway anchors resolve exactly one flight; the footbridge's resolves none", () => {
    expect(flights.map((f) => f.floor).sort()).toEqual([SUBWAY_FLOOR, 0]);
  });

  it("takes each drop from the declared art, signed toward the target floor", () => {
    const declared = new Map(
      defs.objects.filter((o) => o.flight !== undefined).map((o) => [o.key, o.flight?.dropPx]),
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

  // The footbridge's `foot_stairs` is one cell and fires on entry: it has no
  // walked path to spread an offset along (story 15.19 re-lays it). Named by
  // the fixture's own constants, so a new stairwell with no declared drop is
  // in neither list and fails here by name.
  const EXEMPT_ANCHORS = [
    { x: BRIDGE_UP_ANCHOR_X, y: BRIDGE_UP_ANCHOR_Y, floor: 0 },
    { x: BRIDGE_DOWN_ANCHOR_X, y: BRIDGE_DOWN_ANCHOR_Y, floor: BRIDGE_FLOOR },
  ];

  it("every transition anchor resolves a flight or is a named exemption", () => {
    const { pairings, unpaired } = pairTransitions(STREET_TRANSITIONS);
    expect(unpaired).toEqual([]);
    for (const { forward, reverse } of pairings) {
      for (const anchor of [forward, reverse]) {
        const covered = flights.some(
          (f) =>
            f.floor === anchor.floor &&
            anchor.x >= f.x0 &&
            anchor.x < f.x1 &&
            anchor.y >= f.y0 &&
            anchor.y < f.y1,
        );
        const exempt = EXEMPT_ANCHORS.some(
          (e) => e.x === anchor.x && e.y === anchor.y && e.floor === anchor.floor,
        );
        expect(
          covered !== exempt,
          `anchor (${anchor.x}, ${anchor.y}, floor ${anchor.floor}) must resolve a flight or be a named exemption, not both or neither`,
        ).toBe(true);
      }
    }
  });

  it("no two adjacent standable feet positions differ by more than the steepest slope (never off the surface)", () => {
    const index = new FlightIndex(flights, config);
    const world = streetWorldIndex();
    const sub = config.subcellsPerCell;
    const slope = Math.max(
      ...flights.map((f) => Math.abs(f.dropPx) / ((f.fullS - f.startS) * sub)),
    );
    let nonZero = 0;
    for (const floor of [0, SUBWAY_FLOOR]) {
      for (let cx = 0; cx < 46 * sub; cx++) {
        for (let feet = 0; feet < 26 * sub; feet++) {
          if (!isBodyClear(world, config, floor, cx, feet)) continue;
          const here = index.offsetPx(cx / sub, feet / sub, floor);
          if (here !== 0) nonZero++;
          for (const [nx, ny] of [
            [cx + 1, feet],
            [cx, feet + 1],
          ] as const) {
            if (!isBodyClear(world, config, floor, nx, ny)) continue;
            const there = index.offsetPx(nx / sub, ny / sub, floor);
            if (Math.abs(there - here) > slope + 1e-9) {
              throw new Error(
                `floor ${floor}: (${cx}, ${feet}) -> (${nx}, ${ny}) jumps ${there - here} sub-cell units`,
              );
            }
          }
        }
      }
    }
    expect(nonZero).toBeGreaterThan(0);
  });
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

describe("a flight's ramp follows the drawn nosings (FR182)", () => {
  const defs = committedDefs();
  const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
  const flights = buildFlights(
    STREET_TRANSITIONS,
    streetPlacedRows(),
    streetObjectSources(),
    storey,
    TILE,
  );
  const index = new FlightIndex(flights, config);

  it("every def that declares a flight has a nosing line to be checked against", () => {
    const missing = defs.objects
      .filter((o) => o.flight !== undefined && !(o.key in NOSINGS))
      .map((o) => o.key);
    expect(missing, `flight defs with no NOSINGS entry: ${missing.join(", ")}`).toEqual([]);
  });

  for (const [key, nosing] of Object.entries(NOSINGS)) {
    it(`${key}: the offset at every walkable point is within 1 native px of the nosing line`, () => {
      const object = defs.objects.find((o) => o.key === key);
      const row = streetPlacedRows().find((r) => r.defId === object?.id);
      if (!object || !row) throw new Error(`no ${key}`);
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

  it("the platform flight's drawn top rows step by the declared drop", () => {
    const object = defs.objects.find((o) => o.key === "platform_stair_flight");
    if (!object) throw new Error("no platform_stair_flight");
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const png = PNG.sync.read(readFileSync(`${root}${object.sprite.sheet}`));
    const top = (x: number): number => {
      for (let y = 0; y < object.sprite.h; y++) {
        const a = png.data[((object.sprite.y + y) * png.width + object.sprite.x + x) * 4 + 3] ?? 0;
        if (a > 0) return y;
      }
      return -1;
    };
    const first = top(0);
    const last = top(object.sprite.w - 1);
    expect(first - last).toBe(object.flight?.dropPx);
  });
});
