import { describe, expect, it } from "vitest";
import { CitizenBody } from "../../../src/l3/citizen";
import { pathConfigOf, walkFramesPerCycle } from "../../../src/l3/config";
import {
  AVOIDANCE_SPECS,
  BYSTANDER_CELL,
  BYSTANDER_ID,
  BYSTANDER_OFF_LINE_CELL,
  BYSTANDER_OFF_LINE_ID,
  buildAvoidanceFixtures,
  CROSSER_EAST_ID,
  CROSSER_WEST_ID,
  PASSER_ID,
  stagingBounds,
  TWIN_A_ID,
  TWIN_B_ID,
} from "../../../src/test-street/citizens";
import { lifeDialsFor, StreetLife, standState } from "../../../src/test-street/street-life";
import { Timetable } from "../../../src/test-street/timetable";
import { npcWalkability } from "../../../src/world/npc-walkable";
import { l3Config } from "../l3/defs-config";
import { committedDefs, streetWorldIndex } from "./street-world";

const streetWalk = npcWalkability(streetWorldIndex());

const cfg = l3Config();
const defs = committedDefs();
const path = pathConfigOf(cfg);
const open = { revision: () => 0, walkable: () => true };
const gait = { strideCells: cfg.strideCells, framesPerCycle: walkFramesPerCycle(defs, "adult") };
const life = lifeDialsFor(defs, cfg, "adult");

const walking = [CROSSER_EAST_ID, CROSSER_WEST_ID, PASSER_ID, TWIN_A_ID, TWIN_B_ID];
const standing = [
  { id: BYSTANDER_ID, cell: BYSTANDER_CELL },
  { id: BYSTANDER_OFF_LINE_ID, cell: BYSTANDER_OFF_LINE_CELL },
];
const period = new Timetable(AVOIDANCE_SPECS[CROSSER_EAST_ID] as never, cfg, open, path)
  .periodMilli;

/** The staging as the street's life holds it, optionally without some citizens. */
function build(without: readonly string[] = []) {
  const street = new StreetLife(cfg, open);
  for (const id of walking) {
    if (without.includes(id)) continue;
    const make = () => ({
      timetable: new Timetable(AVOIDANCE_SPECS[id] as never, cfg, open, path),
      body: new CitizenBody(open, path, gait, id, life),
    });
    street.add({ id, ...make(), remake: make });
  }
  for (const { id, cell } of standing) {
    if (without.includes(id)) continue;
    const make = () => ({ body: new CitizenBody(open, path, gait, id, life) });
    street.add({
      id,
      ...make(),
      stand: standState({ x: Math.floor(cell.x), y: Math.floor(cell.y) }, 0, "down"),
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

describe("the avoidance staging on the test street (story 5.2)", () => {
  it("is plain data on its own pavement, and no two citizens ever stand on one cell", () => {
    const b = stagingBounds();
    const fixtures = buildAvoidanceFixtures(defs);
    expect(fixtures.map((f) => f.id).sort()).toEqual(
      [...walking, ...standing.map((s) => s.id)].sort(),
    );
    for (const f of fixtures) {
      expect(f.gridX).toBeGreaterThan(b.x0);
      expect(f.gridX).toBeLessThan(b.x1);
      expect(f.gridY).toBeGreaterThan(b.y0);
      expect(f.gridY).toBeLessThan(b.y1);
    }
    // Every cell on every lane is on that pavement, and none is a wall of the street.
    for (const id of walking) {
      const route = (AVOIDANCE_SPECS[id] as unknown as { out: { x: number; y: number }[] }).out;
      for (const c of route) {
        expect(c.x).toBeGreaterThanOrEqual(b.x0);
        expect(c.x).toBeLessThan(b.x1);
        expect(c.y).toBeGreaterThanOrEqual(b.y0);
        expect(c.y).toBeLessThan(b.y1);
        expect(streetWalk.walkable(0, c.x, c.y)).toBe(true);
      }
    }
    // At no moment do two citizens stand on one cell.
    const street = build();
    for (let t = 0; t < 2 * period; t += 10) {
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
    for (let t = 0; t < period; t += 5) {
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
    const alone = build([PASSER_ID, TWIN_A_ID, TWIN_B_ID, BYSTANDER_ID, BYSTANDER_OFF_LINE_ID]);
    for (let t = 0; t < period; t += 25) {
      street.solve(t);
      alone.solve(t);
      for (const id of [CROSSER_EAST_ID, CROSSER_WEST_ID]) {
        expect(pose(street, id).oy).toBeCloseTo(pose(alone, id).oy, 9);
      }
    }
  });

  it("a walker steps round the standing citizen on its line and is left alone by one a cell off it", () => {
    const street = build();
    const without = build([BYSTANDER_OFF_LINE_ID]);
    let widest = 0;
    for (let t = 0; t < period; t += 5) {
      street.solve(t);
      without.solve(t);
      for (const id of [BYSTANDER_ID, BYSTANDER_OFF_LINE_ID]) {
        const s = pose(street, id);
        expect([s.ox, s.oy]).toEqual([0, 0]);
      }
      const p = pose(street, PASSER_ID);
      if (!p.frame.moving) expect([p.ox, p.oy]).toEqual([0, 0]);
      widest = Math.max(widest, Math.abs(p.oy));
      // The stander a cell off the line changes nothing for the passer.
      expect(p.oy).toBeCloseTo(pose(without, PASSER_ID).oy, 9);
    }
    expect(widest).toBeGreaterThan(0.6);
  });

  it("two citizens walking a cell apart on one lane spread by id and never close", () => {
    const street = build();
    let spread = 0;
    for (let t = 0; t < period; t += 5) {
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

  it("no walker facing depends on the sidestep, and a standing body is never displaced", () => {
    const street = build();
    for (let t = 0; t < period; t += 5) {
      street.solve(t);
      for (const w of street.members) {
        if (w.frame.moving) {
          expect(w.frame.direction).toBe(w.frame.headingX > 0 ? "right" : "left");
        } else {
          expect([street.offsetX(w), street.offsetY(w)]).toEqual([0, 0]);
        }
      }
    }
  });

  it("is deterministic from scratch: the agreement sample equals a long-lived solve", () => {
    const street = build();
    const fresh = build();
    for (let t = 0; t < period; t += 37) {
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
