// Story 15.21 (FR183, FR149, FR182): a flight's ramp scales the walked step
// so the drawn displacement (ground step plus the change in the flight
// offset) keeps walking pace, from the same `Flight` data `offsetPx` reads.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { advanceSurfaceGait } from "../../../src/l3/gait";
import type { CollisionGridQuery, GridEntry } from "../../../src/world/collision-grid";
import { type Flight, FlightIndex } from "../../../src/world/flights";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import { MAX_DELTA_MS, step } from "../../../src/world/movement";
import { TransitionIndex } from "../../../src/world/transitions";
import {
  STREET_TRANSITIONS,
  streetFlightIndex,
  streetFlightList,
  streetMovementConfig,
  streetWorldIndex,
} from "../support/stairs-world";
import { OPEN_ENTRY_BAND } from "./entry-band";

const TILE = 16;
const TICK_MS = 16;
const config = streetMovementConfig();
const flights = streetFlightList();
const index = streetFlightIndex();
const OPEN: CollisionGridQuery = {
  entriesInCell(): readonly GridEntry[] {
    return [];
  },
};
const flatCells = (ms: number) => config.walkSpeedCellsPerMs * ms;
const FLAT_PX = flatCells(TICK_MS) * TILE;
/** Float noise only: the drawn step is exact. */
const EXACT = 1e-5;
/** The drawn path length is within this of the flat step. */
const PATH_TOL = 1e-5;

function drawnPx(
  at: FlightIndex,
  from: { x: number; y: number },
  to: { x: number; y: number },
  floor: number,
): number {
  const dy =
    (to.y - from.y) * TILE + (at.offsetPx(to.x, to.y, floor) - at.offsetPx(from.x, from.y, floor));
  return Math.hypot((to.x - from.x) * TILE, dy);
}

/** The drawn path length of a straight ground move: the offset is linear
 * between the ramps' ends, so the path is measured piece by piece, cut where
 * the move crosses one -- the bends at a ramp's edges included. */
function drawnPathPx(
  at: FlightIndex,
  from: { x: number; y: number },
  to: { x: number; y: number },
  floor: number,
): number {
  const cuts = [0, 1];
  for (const f of flights) {
    if (f.floor !== floor) continue;
    const s0 = from.x * f.dirX + from.y * f.dirY;
    const s1 = to.x * f.dirX + to.y * f.dirY;
    if (s0 === s1) continue;
    for (const edge of [f.startS, f.fullS]) {
      const t = (edge - s0) / (s1 - s0);
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  cuts.sort((p, q) => p - q);
  let total = 0;
  let prev = from;
  for (const t of cuts.slice(1)) {
    const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    total += drawnPx(at, prev, p, floor);
    prev = p;
  }
  return total;
}

/** The footprint's lowest axis coordinate: the open edge. */
function openEdgeS(f: Flight): number {
  if (f.dirX !== 0) return f.dirX > 0 ? f.x0 : -f.x1;
  return f.dirY > 0 ? f.y0 : -f.y1;
}

function lengthCells(f: Flight): number {
  return f.dirX !== 0 ? f.x1 - f.x0 : f.y1 - f.y0;
}

/** A feet point at axis coordinate `s`, `side` of the way across the footprint. */
function pointAt(f: Flight, s: number, side: number) {
  return {
    x: f.dirX !== 0 ? s * f.dirX : f.x0 + (0.1 + 0.8 * side) * (f.x1 - f.x0),
    y: f.dirY !== 0 ? s * f.dirY : f.y0 + (0.1 + 0.8 * side) * (f.y1 - f.y0),
  };
}

const directions = fc
  .double({ min: 0, max: Math.PI * 2, noNaN: true })
  .map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));
const unit = fc.double({ min: 0, max: 1, noNaN: true });

/** Synthetic flights over a range of slopes (both signs, through +-1 and
 * +-2, where the drawn step degenerates), ramp lengths and axes. */
const syntheticFlight = fc
  .record({
    axis: fc.constantFrom(
      { dirX: 1, dirY: 0 },
      { dirX: -1, dirY: 0 },
      { dirX: 0, dirY: 1 },
      { dirX: 0, dirY: -1 },
    ),
    slope: fc.oneof(
      fc.constantFrom(-2, -1, -0.5, 0, 0.5, 1, 1.5, 2),
      fc.double({ min: -3, max: 3, noNaN: true }),
    ),
    rampCells: fc.integer({ min: 1, max: 4 }),
    fromCells: fc.constantFrom(0, 0.25, 0.5),
  })
  .map(({ axis, slope, rampCells, fromCells }): Flight => {
    const length = rampCells + 2;
    const x0 = 3;
    const y0 = 3;
    const x1 = axis.dirX !== 0 ? x0 + length : x0 + 3;
    const y1 = axis.dirY !== 0 ? y0 + length : y0 + 3;
    const lo = axis.dirX !== 0 ? (axis.dirX > 0 ? x0 : -x1) : axis.dirY > 0 ? y0 : -y1;
    const startS = lo + fromCells;
    return {
      floor: 0,
      x0,
      y0,
      x1,
      y1,
      dirX: axis.dirX,
      dirY: axis.dirY,
      startS,
      fullS: startS + rampCells,
      dropPx: slope * rampCells * TILE,
      slope,
    };
  });

const indexOf = (flight: Flight): FlightIndex => new FlightIndex([flight], config);

describe("a flight's ramp keeps the drawn step at walking pace (FR183)", () => {
  it("has flights to test", () => {
    expect(flights.length).toBeGreaterThan(0);
  });

  it("inv_stair_pace_is_walking_pace: along the axis, from before the ramp to past it, at any tick length, the drawn step is the flat step", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...flights),
        unit,
        unit,
        fc.constantFrom(1, -1),
        fc.integer({ min: 1, max: MAX_DELTA_MS }),
        (flight, t, side, sign, ms) => {
          const lo = openEdgeS(flight);
          const margin = flatCells(MAX_DELTA_MS) + 1e-3;
          const s = lo + margin + t * (lengthCells(flight) - 2 * margin);
          const from = pointAt(flight, s, side);
          const dir = { x: flight.dirX * sign, y: flight.dirY * sign };
          const scale = index.stepScale(from.x, from.y, flight.floor, dir.x, dir.y, ms);
          const to = step(from, dir, ms, OPEN, flight.floor, config, scale);
          const drawn = drawnPathPx(index, from, to, flight.floor);
          expect(Math.abs(drawn - flatCells(ms) * TILE)).toBeLessThan(PATH_TOL);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("inv_stair_pace_is_walking_pace: any direction inside a ramp, the drawn step is the flat step", () => {
    fc.assert(
      fc.property(fc.constantFrom(...flights), unit, unit, directions, (flight, t, side, dir) => {
        const margin = flatCells(TICK_MS) * 3;
        const span = flight.fullS - flight.startS;
        fc.pre(span > 2 * margin);
        const from = pointAt(flight, flight.startS + margin + t * (span - 2 * margin), side);
        const scale = index.stepScale(from.x, from.y, flight.floor, dir.x, dir.y, TICK_MS);
        const to = step(from, dir, TICK_MS, OPEN, flight.floor, config, scale);
        const drawn = drawnPx(index, from, to, flight.floor);
        // Flat, unless the clamp is active (the stairs would speed it up).
        const unclamped = Math.hypot(
          dir.x,
          dir.y + flight.slope * (dir.x * flight.dirX + dir.y * flight.dirY),
        );
        if (unclamped > 1) expect(Math.abs(drawn - FLAT_PX)).toBeLessThan(EXACT);
        else expect(drawn).toBeLessThanOrEqual(FLAT_PX + EXACT);
      }),
      { numRuns: 500 },
    );
  });

  it("inv_stair_pace_is_bounded: on any synthetic flight the scale is finite in (0, 1], exactly 1 off the ramp and across it, and the drawn step is flat wherever the clamp is not active", () => {
    fc.assert(
      fc.property(syntheticFlight, unit, unit, directions, (flight, t, side, dir) => {
        const at = indexOf(flight);
        const span = flight.fullS - flight.startS;
        const inside = pointAt(flight, flight.startS + t * span, side);
        const scale = at.paceScale(inside.x, inside.y, 0, dir.x, dir.y);
        expect(Number.isFinite(scale)).toBe(true);
        expect(scale).toBeGreaterThan(0);
        expect(scale).toBeLessThanOrEqual(1);

        // Off the ramp: before its first tread, past its last, on another floor.
        const before = pointAt(flight, flight.startS - 0.01, side);
        const after = pointAt(flight, flight.fullS + 0.01, side);
        expect(at.paceScale(before.x, before.y, 0, dir.x, dir.y)).toBe(1);
        expect(at.paceScale(after.x, after.y, 0, dir.x, dir.y)).toBe(1);
        expect(at.paceScale(inside.x, inside.y, 1, dir.x, dir.y)).toBe(1);

        // Across the axis nothing is climbed.
        const across = flight.dirX !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
        expect(at.paceScale(inside.x, inside.y, 0, across.x, across.y)).toBe(1);

        // Inside the ramp the drawn step is flat unless the clamp is active
        // (the stairs would speed the walker up), where it is shorter.
        const margin = flatCells(TICK_MS) * 3;
        fc.pre(span > 2 * margin);
        const from = pointAt(flight, flight.startS + margin + t * (span - 2 * margin), side);
        const factor = at.paceScale(from.x, from.y, 0, dir.x, dir.y);
        const to = step(from, dir, TICK_MS, OPEN, 0, config, factor);
        const drawn = drawnPx(at, from, to, 0);
        const unclamped = Math.hypot(
          dir.x,
          dir.y + flight.slope * (dir.x * flight.dirX + dir.y * flight.dirY),
        );
        if (unclamped > 1) expect(Math.abs(drawn - FLAT_PX)).toBeLessThan(EXACT);
        else expect(drawn).toBeLessThanOrEqual(FLAT_PX + EXACT);
      }),
      { numRuns: 500 },
    );
  });

  it("inv_stair_pace_is_direction_independent: a direction and its reverse agree, and length is ignored", () => {
    fc.assert(
      fc.property(syntheticFlight, unit, unit, directions, (flight, t, side, dir) => {
        const at = indexOf(flight);
        const p = pointAt(flight, flight.startS + t * (flight.fullS - flight.startS), side);
        const forward = at.paceScale(p.x, p.y, 0, dir.x, dir.y);
        const back = at.paceScale(p.x, p.y, 0, -dir.x, -dir.y);
        const long = at.paceScale(p.x, p.y, 0, dir.x * 7, dir.y * 7);
        expect(back).toBeCloseTo(forward, 12);
        expect(long).toBeCloseTo(forward, 12);
      }),
    );
  });

  it("inv_stair_pace_preserves_path: the paced step is the unpaced step, shorter, on the same ray and the same colliders", () => {
    const world = streetWorldIndex();
    fc.assert(
      fc.property(fc.constantFrom(...flights), unit, unit, directions, (flight, t, side, dir) => {
        const s = flight.startS + t * (flight.fullS - flight.startS);
        const from = pointAt(flight, s, side);
        const scale = index.stepScale(from.x, from.y, flight.floor, dir.x, dir.y, TICK_MS);
        expect(scale).toBeLessThanOrEqual(1 + 1e-12);
        const full = step(from, dir, TICK_MS, OPEN, flight.floor, config, 1);
        const paced = step(from, dir, TICK_MS, OPEN, flight.floor, config, scale);
        expect((paced.x - from.x) * (full.y - from.y)).toBeCloseTo(
          (paced.y - from.y) * (full.x - from.x),
          12,
        );
        expect(Math.hypot(paced.x - from.x, paced.y - from.y)).toBeLessThanOrEqual(
          Math.hypot(full.x - from.x, full.y - from.y) + 1e-12,
        );
        // Against the real colliders the paced end is never further along.
        const longScale = index.stepScale(from.x, from.y, flight.floor, dir.x, dir.y, MAX_DELTA_MS);
        const blockedFull = step(from, dir, MAX_DELTA_MS, world, flight.floor, config, 1);
        const blockedPaced = step(from, dir, MAX_DELTA_MS, world, flight.floor, config, longScale);
        expect(Math.hypot(blockedPaced.x - from.x, blockedPaced.y - from.y)).toBeLessThanOrEqual(
          Math.hypot(blockedFull.x - from.x, blockedFull.y - from.y) + 1e-9,
        );
      }),
    );
  });
});

describe("the walk onto, along and off every flight (FR149)", () => {
  const world = streetWorldIndex();
  const transitions = new TransitionIndex(STREET_TRANSITIONS, {
    skipPairSymmetry: true,
    entryBand: OPEN_ENTRY_BAND,
  });

  /** Walks `flight` along its own axis from its open edge, one tick at a
   * time through `stepAndTransition`, until the floor changes. */
  function climb(flight: Flight, withFlights: FlightIndex, tickMs: number) {
    const anchor = STREET_TRANSITIONS.find(
      (tr) =>
        tr.floor === flight.floor &&
        tr.x >= flight.x0 &&
        tr.x < flight.x1 &&
        tr.y >= flight.y0 &&
        tr.y < flight.y1,
    );
    if (!anchor) throw new Error("no anchor for the flight");
    const startX = flight.dirX === 0 ? anchor.x + 0.5 : flight.dirX > 0 ? flight.x0 : flight.x1;
    const startY = flight.dirY === 0 ? anchor.y + 0.5 : flight.dirY > 0 ? flight.y0 : flight.y1;
    let state = initialFloorWalkState(startX, startY, flight.floor);
    const dir = { x: flight.dirX, y: flight.dirY };
    const moves: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
    let n = 0;
    while (n < 4000) {
      const before = state;
      state = stepAndTransition(state, dir, tickMs, world, config, transitions, withFlights);
      n++;
      // The floor change is a cut, not walked surface.
      if (state.floor !== before.floor) break;
      moves.push({ from: { x: before.x, y: before.y }, to: { x: state.x, y: state.y } });
    }
    return { moves, seconds: (n * tickMs) / 1000, changed: state.floor !== flight.floor };
  }

  it("inv_stair_pace_is_walking_pace on a real walk: every tick but the floor change is the flat step, at any tick length", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...flights),
        fc.integer({ min: 1, max: MAX_DELTA_MS }),
        (flight, tickMs) => {
          const { moves, changed } = climb(flight, index, tickMs);
          expect(changed).toBe(true);
          for (const m of moves) {
            const drawn = drawnPathPx(index, m.from, m.to, flight.floor);
            expect(Math.abs(drawn - flatCells(tickMs) * TILE)).toBeLessThan(PATH_TOL);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Seconds from the open edge to the floor change at 16 ms ticks, keyed by
  // `floor:dirX,dirY`. A change to pace or geometry updates this table, and
  // the PR's table is copied from it.
  const CLIMB_SECONDS: Record<string, { before: number; after: number }> = {
    "0:-1,0": { before: 0.912, after: 0.944 },
    "-1:1,0": { before: 0.464, after: 0.464 },
    "0:0,-1": { before: 0.464, after: 1.152 },
    "1:0,1": { before: 0.464, after: 1.152 },
  };

  it("climb time before and after, per flight, is pinned", () => {
    expect(flights.length).toBe(Object.keys(CLIMB_SECONDS).length);
    for (const flight of flights) {
      const key = `${flight.floor}:${flight.dirX},${flight.dirY}`;
      const expected = CLIMB_SECONDS[key];
      if (!expected) throw new Error(`no pinned climb time for ${key}`);
      const before = climb(flight, new FlightIndex([], config), TICK_MS).seconds;
      const after = climb(flight, index, TICK_MS).seconds;
      expect(before, `${key} before`).toBeCloseTo(expected.before, 3);
      expect(after, `${key} after`).toBeCloseTo(expected.after, 3);
    }
  });

  it("feeds the walk frame the drawn-surface distance: legs keep walking cadence on a flight", () => {
    for (const flight of flights) {
      const { moves } = climb(flight, index, TICK_MS);
      const surface = { facing: "down" as const, walked: 0 };
      const ground = { facing: "down" as const, walked: 0 };
      for (const m of moves) {
        const dx = m.to.x - m.from.x;
        const dy = m.to.y - m.from.y;
        // The remote layer's own per-frame update, on the walked steps.
        advanceSurfaceGait(
          surface,
          dx,
          dy,
          index.drawnDistance(m.from.x, m.from.y, flight.floor, dx, dy),
        );
        ground.walked += Math.hypot(dx, dy);
      }
      expect(surface.walked).toBeCloseTo(moves.length * flatCells(TICK_MS), 6);
      expect(ground.walked).toBeLessThanOrEqual(surface.walked + 1e-9);
    }
  });
});
