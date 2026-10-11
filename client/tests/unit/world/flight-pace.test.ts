// Story 15.21 (FR183, FR149, FR182): a flight's ramp scales the walked step
// so the drawn displacement (ground step plus the change in the flight
// offset) keeps walking pace, from the same `Flight` data `offsetPx` reads.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { advanceGait } from "../../../src/l3/gait";
import { STREET_TRANSITIONS } from "../../../src/test-street/fixture";
import type { CollisionGridQuery, GridEntry } from "../../../src/world/collision-grid";
import { type Flight, FlightIndex } from "../../../src/world/flights";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import { MAX_DELTA_MS, step } from "../../../src/world/movement";
import { TransitionIndex } from "../../../src/world/transitions";
import {
  streetFlightIndex,
  streetFlightList,
  streetMovementConfig,
  streetWorldIndex,
} from "../test-street/street-world";
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
const FLAT_PX = config.walkSpeedCellsPerMs * TICK_MS * TILE;
/** Float noise only: inside one ramp the drawn step is exact. */
const EXACT = 1e-6;

function drawnPx(
  from: { x: number; y: number },
  to: { x: number; y: number },
  floor: number,
): number {
  const dy =
    (to.y - from.y) * TILE +
    (index.offsetPx(to.x, to.y, floor) - index.offsetPx(from.x, from.y, floor));
  return Math.hypot((to.x - from.x) * TILE, dy);
}

/** A feet point inside the flight's ramp, at least `margin` cells from both
 * ends so one tick cannot leave it. */
function rampPoint(flight: Flight, t: number, lateral: number, margin: number) {
  const span = flight.fullS - flight.startS;
  // Kept off the footprint's lateral edge, where the body leaves the flight.
  const side = 0.1 + 0.8 * lateral;
  const s = flight.startS + margin + t * Math.max(0, span - 2 * margin);
  return {
    x: flight.dirX !== 0 ? s * flight.dirX : flight.x0 + side * (flight.x1 - flight.x0),
    y: flight.dirY !== 0 ? s * flight.dirY : flight.y0 + side * (flight.y1 - flight.y0),
  };
}

const directions = fc
  .double({ min: 0, max: Math.PI * 2, noNaN: true })
  .map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));
const flightArb = fc.constantFrom(...flights);
const unit = fc.double({ min: 0, max: 1, noNaN: true });

describe("a flight's ramp keeps the drawn step at walking pace (FR183)", () => {
  it("has flights to test", () => {
    expect(flights.length).toBeGreaterThan(0);
  });

  it("inv_stair_pace_is_walking_pace: any direction, anywhere inside a ramp, the drawn step is the flat step", () => {
    fc.assert(
      fc.property(flightArb, unit, unit, directions, (flight, t, lateral, dir) => {
        const span = flight.fullS - flight.startS;
        const margin = (FLAT_PX / TILE) * 3;
        fc.pre(span > 2 * margin);
        const from = rampPoint(flight, t, lateral, margin);
        const scale = index.paceScale(from.x, from.y, flight.floor, dir.x, dir.y);
        const to = step(from, dir, TICK_MS, OPEN, flight.floor, config, scale);
        expect(Math.abs(drawnPx(from, to, flight.floor) - FLAT_PX)).toBeLessThan(EXACT);
      }),
      { numRuns: 500 },
    );
  });

  it("is exactly 1 off every ramp, and across a flight's axis", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -2, max: 60, noNaN: true }),
        fc.double({ min: -2, max: 40, noNaN: true }),
        fc.constantFrom(-1, 0, 1),
        directions,
        (x, y, floor, dir) => {
          const onFlight = flights.some(
            (f) =>
              f.floor === floor &&
              x * f.dirX + y * f.dirY > f.startS &&
              x * f.dirX + y * f.dirY < f.fullS &&
              x > f.x0 - 1 &&
              x < f.x1 + 1 &&
              y > f.y0 - 1 &&
              y < f.y1 + 1,
          );
          if (!onFlight) expect(index.paceScale(x, y, floor, dir.x, dir.y)).toBe(1);
        },
      ),
    );
    for (const flight of flights) {
      const mid = rampPoint(flight, 0.5, 0.5, 0);
      const across = flight.dirX !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
      expect(index.paceScale(mid.x, mid.y, flight.floor, across.x, across.y)).toBeCloseTo(1, 12);
    }
  });

  it("inv_stair_pace_is_direction_independent: a direction and its reverse agree, and length is ignored", () => {
    fc.assert(
      fc.property(flightArb, unit, unit, directions, (flight, t, lateral, dir) => {
        const p = rampPoint(flight, t, lateral, 0);
        const forward = index.paceScale(p.x, p.y, flight.floor, dir.x, dir.y);
        const back = index.paceScale(p.x, p.y, flight.floor, -dir.x, -dir.y);
        const long = index.paceScale(p.x, p.y, flight.floor, dir.x * 7, dir.y * 7);
        expect(back).toBeCloseTo(forward, 12);
        expect(long).toBeCloseTo(forward, 12);
      }),
    );
  });

  it("inv_stair_pace_preserves_path: the paced step is the unpaced step, shorter, on the same ray and the same colliders", () => {
    const world = streetWorldIndex();
    fc.assert(
      fc.property(flightArb, unit, unit, directions, (flight, t, lateral, dir) => {
        const from = rampPoint(flight, t, lateral, 0);
        const scale = index.paceScale(from.x, from.y, flight.floor, dir.x, dir.y);
        expect(scale).toBeLessThanOrEqual(1 + 1e-12);
        const full = step(from, dir, TICK_MS, OPEN, flight.floor, config, 1);
        const paced = step(from, dir, TICK_MS, OPEN, flight.floor, config, scale);
        expect((paced.x - from.x) * (full.y - from.y)).toBeCloseTo(
          (paced.y - from.y) * (full.x - from.x),
          12,
        );
        expect(Math.hypot(paced.x - from.x, paced.y - from.y)).toBeCloseTo(
          scale * Math.hypot(full.x - from.x, full.y - from.y),
          12,
        );
        // Against the real colliders the paced end is never further along
        // than the unpaced end.
        const blockedFull = step(from, dir, MAX_DELTA_MS, world, flight.floor, config, 1);
        const blockedPaced = step(from, dir, MAX_DELTA_MS, world, flight.floor, config, scale);
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
  function climb(flight: Flight, withFlights: FlightIndex) {
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
    const ticks: number[] = [];
    let n = 0;
    while (n < 2000) {
      const before = state;
      state = stepAndTransition(state, dir, TICK_MS, world, config, transitions, withFlights);
      n++;
      // The floor change is a cut, not walked surface.
      if (state.floor !== before.floor) break;
      ticks.push(drawnPx(before, state, before.floor));
    }
    return { ticks, seconds: (n * TICK_MS) / 1000, changed: state.floor !== flight.floor };
  }

  it("inv_stair_pace_is_walking_pace on a real walk: only the ticks straddling a ramp edge differ from flat pace", () => {
    for (const flight of flights) {
      const { ticks, changed } = climb(flight, index);
      expect(changed).toBe(true);
      const k = flight.dropPx / ((flight.fullS - flight.startS) * TILE);
      const worst = FLAT_PX * (1 + Math.abs(k));
      const off = ticks.filter((px) => Math.abs(px - FLAT_PX) > EXACT);
      // Entering and leaving the ramp: at most one tick each, bounded by 1 / scale.
      expect(off.length).toBeLessThanOrEqual(2);
      for (const px of ticks) expect(px).toBeLessThanOrEqual(worst + EXACT);
    }
  });

  it("climb time before and after, per flight (copied into the PR)", () => {
    const rows: string[] = [];
    for (const flight of flights) {
      const before = climb(flight, new FlightIndex([], config));
      const after = climb(flight, index);
      expect(after.seconds).toBeGreaterThanOrEqual(before.seconds);
      rows.push(
        `floor ${flight.floor} dir(${flight.dirX},${flight.dirY}) drop ${flight.dropPx}px ramp ${(flight.fullS - flight.startS) * TILE}px: ${before.seconds.toFixed(3)} s -> ${after.seconds.toFixed(3)} s`,
      );
    }
    console.log(rows.join("\n"));
  });
});

describe("the gait is fed drawn-surface distance (FR183)", () => {
  it("feeds the gait the drawn-surface distance, so the legs keep walking cadence", () => {
    const flat = { facing: "down" as const, walked: 0 };
    const paced = { facing: "down" as const, walked: 0 };
    for (const flight of flights) {
      const from = rampPoint(flight, 0.5, 0.5, 0.1);
      const dir = { x: flight.dirX, y: flight.dirY };
      const scale = index.paceScale(from.x, from.y, flight.floor, dir.x, dir.y);
      const full = step(from, dir, TICK_MS, OPEN, flight.floor, config, 1);
      const slow = step(from, dir, TICK_MS, OPEN, flight.floor, config, scale);
      advanceGait(flat, full.x - from.x, full.y - from.y);
      // The remote layer divides the observed ground step by the same scale.
      advanceGait(paced, (slow.x - from.x) / scale, (slow.y - from.y) / scale);
    }
    expect(paced.walked).toBeCloseTo(flat.walked, 9);
  });
});
