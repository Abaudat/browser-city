import { describe, expect, it } from "vitest";
import { CitizenBody } from "../../../src/l3/citizen";
import { pathConfigOf, walkFramesPerCycle } from "../../../src/l3/config";
import {
  AVOIDANCE_SPECS,
  AVOIDANCE_STANDERS,
  BYSTANDER_ID,
  BYSTANDER_OFF_LINE_ID,
  buildAvoidanceFixtures,
  CROSSER_EAST_ID,
  CROSSER_WEST_ID,
  DIAGONAL_A_ID,
  DIAGONAL_B_ID,
  isStagingCell,
  isStagingKerb,
  KERB_WALKER_ID,
  PASSER_ID,
  stagingBounds,
  TWIN_A_ID,
  TWIN_B_ID,
  withStagingKerb,
} from "../../../src/test-street/citizens";
import { lifeDialsFor, StreetLife, standState } from "../../../src/test-street/street-life";
import { Timetable } from "../../../src/test-street/timetable";
import { npcWalkability } from "../../../src/world/npc-walkable";
import { l3Config } from "../l3/defs-config";
import { committedDefs, streetWorldIndex } from "./street-world";

const cfg = l3Config();
const defs = committedDefs();
const path = pathConfigOf(cfg);
const streetWalk = npcWalkability(streetWorldIndex());
const walk = withStagingKerb(streetWalk);
const gait = { strideCells: cfg.strideCells, framesPerCycle: walkFramesPerCycle(defs, "adult") };
const life = lifeDialsFor(defs, cfg, "adult");

const walking = Object.keys(AVOIDANCE_SPECS);
const standing = Object.keys(AVOIDANCE_STANDERS);
const period = new Timetable(AVOIDANCE_SPECS[CROSSER_EAST_ID] as never, cfg, walk, path)
  .periodMilli;

/** The staging as the street's life holds it, without the citizens named. */
function build(without: readonly string[] = []) {
  const street = new StreetLife(cfg, walk);
  for (const id of walking) {
    if (without.includes(id)) continue;
    const make = () => ({
      timetable: new Timetable(AVOIDANCE_SPECS[id] as never, cfg, walk, path),
      body: new CitizenBody(walk, path, gait, id, life),
    });
    street.add({ id, ...make(), remake: make });
  }
  for (const id of standing) {
    if (without.includes(id)) continue;
    const cell = AVOIDANCE_STANDERS[id] as { x: number; y: number };
    const make = () => ({ body: new CitizenBody(walk, path, gait, id, life) });
    street.add({
      id,
      ...make(),
      stand: standState(cell, 0, "down"),
      standAt: { x: cell.x + 0.5, y: cell.y + 0.5 },
      remake: make,
    });
  }
  return street;
}

function pose(street: StreetLife, id: string) {
  const m = street.members.find((q) => q.id === id);
  if (!m) throw new Error(`no member ${id}`);
  return {
    x: m.frame.x,
    y: m.frame.y,
    ox: street.offsetX(m),
    oy: street.offsetY(m),
    frame: m.frame,
  };
}

const only = (...ids: string[]) => [...walking, ...standing].filter((id) => !ids.includes(id));

describe("the avoidance staging on the test street (story 5.2)", () => {
  it("is plain data on its own pavement, walkable, and no two citizens ever stand on one cell", () => {
    const b = stagingBounds();
    const fixtures = buildAvoidanceFixtures(defs);
    expect(fixtures.map((f) => f.id).sort()).toEqual([...walking, ...standing].sort());
    for (const f of fixtures) {
      expect(isStagingCell(Math.floor(f.gridX), Math.floor(f.gridY))).toBe(true);
      expect(f.gridX).toBeGreaterThan(b.x0);
      expect(f.gridX).toBeLessThan(b.x1);
    }
    // Every cell of every lane is staging pavement the street leaves open; the
    // kerb is a wall.
    for (const id of walking) {
      const route = (AVOIDANCE_SPECS[id] as unknown as { out: { x: number; y: number }[] }).out;
      for (const c of route) {
        expect(isStagingCell(c.x, c.y)).toBe(true);
        expect(walk.walkable(0, c.x, c.y)).toBe(true);
      }
    }
    expect(isStagingKerb(11, 16)).toBe(true);
    expect(walk.walkable(0, 11, 16)).toBe(false);
    expect(streetWalk.walkable(0, 11, 16)).toBe(true);
    // At no moment do two citizens stand on one cell.
    const street = build();
    for (let t = 0; t < 2 * period; t += 40) {
      street.solve(t);
      const resting = street.members.filter((m) => !m.frame.moving);
      for (const p of resting) {
        for (const q of resting) {
          if (p === q) continue;
          expect(Math.hypot(p.frame.x - q.frame.x, p.frame.y - q.frame.y)).toBeGreaterThan(0.99);
        }
      }
    }
    expect(new Set(fixtures.map((f) => JSON.stringify(f.tuple))).size).toBe(fixtures.length);
  });

  it("two citizens meet head-on in an empty lane and pass a body width apart", () => {
    const street = build();
    let closestLedger = Number.POSITIVE_INFINITY;
    let closestDrawn = Number.POSITIVE_INFINITY;
    for (let t = 0; t < period; t += 30) {
      street.solve(t);
      const a = pose(street, CROSSER_EAST_ID);
      const b = pose(street, CROSSER_WEST_ID);
      closestLedger = Math.min(closestLedger, Math.hypot(a.x - b.x, a.y - b.y));
      closestDrawn = Math.min(
        closestDrawn,
        Math.hypot(a.x + a.ox - b.x - b.ox, a.y + a.oy - b.y - b.oy),
      );
      // Each steps to its own right of its heading.
      for (const w of [a, b]) {
        if (w.frame.moving) {
          expect(w.ox * -w.frame.headingY + w.oy * w.frame.headingX).toBeGreaterThanOrEqual(-1e-12);
        }
      }
    }
    expect(closestLedger).toBeLessThan(0.2);
    expect(closestDrawn).toBeGreaterThan(0.8 * cfg.avoidClearanceCells);
    // Nobody else is in that lane: the crossing is the same without anyone else.
    const alone = build(only(CROSSER_EAST_ID, CROSSER_WEST_ID));
    for (let t = 0; t < period; t += 50) {
      street.solve(t);
      alone.solve(t);
      for (const id of [CROSSER_EAST_ID, CROSSER_WEST_ID]) {
        // Only the standing citizen a cell off the lane may limit the room by a hair.
        expect(Math.abs(pose(street, id).oy - pose(alone, id).oy)).toBeLessThan(0.02);
      }
    }
  });

  it("a walker steps round the standing citizen on its line, on the side with room, and walks into neither", () => {
    const street = build();
    let widest = 0;
    let nearest = Number.POSITIVE_INFINITY;
    let nearestOnLine = Number.POSITIVE_INFINITY;
    for (let t = 0; t < period; t += 30) {
      street.solve(t);
      for (const id of standing) {
        const s = pose(street, id);
        expect([s.ox, s.oy]).toEqual([0, 0]);
      }
      const p = pose(street, PASSER_ID);
      if (!p.frame.moving) expect([p.ox, p.oy]).toEqual([0, 0]);
      widest = Math.max(widest, Math.abs(p.oy));
      const far = pose(street, BYSTANDER_OFF_LINE_ID);
      nearest = Math.min(nearest, Math.hypot(p.x + p.ox - far.x, p.y + p.oy - far.y));
      const near = pose(street, BYSTANDER_ID);
      nearestOnLine = Math.min(nearestOnLine, Math.hypot(p.x + p.ox - near.x, p.y + p.oy - near.y));
    }
    expect(widest).toBeGreaterThan(0.6);
    expect(nearest).toBeGreaterThan(0.85);
    expect(nearestOnLine).toBeGreaterThan(0.8 * cfg.avoidClearanceCells);
  });

  it("two citizens walking a cell apart on one lane spread by id and never close", () => {
    const street = build();
    let spread = 0;
    for (let t = 0; t < period; t += 30) {
      street.solve(t);
      const a = pose(street, TWIN_A_ID);
      const b = pose(street, TWIN_B_ID);
      if (!a.frame.moving || !b.frame.moving) continue;
      expect(Math.hypot(a.x + a.ox - b.x - b.ox, a.y + a.oy - b.y - b.oy)).toBeGreaterThanOrEqual(
        Math.hypot(a.x - b.x, a.y - b.y) - 1e-9,
      );
      spread = Math.max(spread, Math.abs(a.oy - b.oy));
    }
    expect(spread).toBeGreaterThan(0.6);
  });

  it("two citizens on crossing diagonals pass each other without a jump", () => {
    const street = build();
    let closestLedger = Number.POSITIVE_INFINITY;
    let closestDrawn = Number.POSITIVE_INFINITY;
    let previous: number[] | undefined;
    let worst = 0;
    for (let t = 0; t < period; t += 12) {
      street.solve(t);
      const a = pose(street, DIAGONAL_A_ID);
      const b = pose(street, DIAGONAL_B_ID);
      if (a.frame.moving && b.frame.moving) {
        closestLedger = Math.min(closestLedger, Math.hypot(a.x - b.x, a.y - b.y));
        closestDrawn = Math.min(
          closestDrawn,
          Math.hypot(a.x + a.ox - b.x - b.ox, a.y + a.oy - b.y - b.oy),
        );
      }
      const now = [a.ox, a.oy, b.ox, b.oy];
      if (previous) {
        const moved = 12 * ((cfg.walkCellsPerS * (cfg.realMsPerCityMinute / 1000)) / 1000);
        for (let i = 0; i < 4; i += 2) {
          worst = Math.max(
            worst,
            Math.hypot(
              (now[i] as number) - (previous[i] as number),
              (now[i + 1] as number) - (previous[i + 1] as number),
            ) /
              (2 * moved),
          );
        }
      }
      previous = now;
    }
    expect(closestLedger).toBeLessThan(0.5);
    // A body's width apart, and a drift, not a lurch: under half a cell of
    // sidestep per cell walked.
    expect(closestDrawn).toBeGreaterThan(0.7);
    expect(worst).toBeLessThan(0.5);
  });

  it("a walker passes a standing citizen with the kerb on its right by taking the open side", () => {
    const street = build();
    let north = 0;
    let south = 0;
    for (let t = 0; t < period; t += 30) {
      street.solve(t);
      const w = pose(street, KERB_WALKER_ID);
      if (w.oy < 0) north = Math.min(north, w.oy);
      else south = Math.max(south, w.oy);
      // The open side is pavement: the walker, edge included, never leaves it.
      expect(isStagingCell(Math.floor(w.x + w.ox), Math.floor(w.y + w.oy - 0.25))).toBe(true);
    }
    expect(north).toBeLessThan(-0.7);
    // Never towards the kerb beyond what its face leaves.
    expect(south).toBeLessThan(0.05);
  });

  it("no walker facing depends on the sidestep, and a standing body is never displaced", () => {
    const street = build();
    for (let t = 0; t < period; t += 30) {
      street.solve(t);
      for (const w of street.members) {
        if (w.frame.moving) {
          if (Math.abs(w.frame.headingX) > Math.abs(w.frame.headingY)) {
            expect(w.frame.direction).toBe(w.frame.headingX > 0 ? "right" : "left");
          }
        } else {
          expect([street.offsetX(w), street.offsetY(w)]).toEqual([0, 0]);
        }
      }
    }
  });

  it("is deterministic from scratch: the agreement sample equals a long-lived solve", () => {
    const street = build();
    const fresh = build();
    for (let t = 0; t < period; t += 97) {
      street.solve(t);
      const sample = fresh.agreementAt(t);
      for (const s of sample) {
        const m = street.members.find((q) => q.id === s.id);
        if (!m) throw new Error("missing");
        expect(Object.is(s.x, m.frame.x)).toBe(true);
        expect(Object.is(s.offsetX, street.offsetX(m))).toBe(true);
        expect(Object.is(s.offsetY, street.offsetY(m))).toBe(true);
        expect(s.frameIndex).toBe(m.frame.frameIndex);
      }
    }
  });
});
