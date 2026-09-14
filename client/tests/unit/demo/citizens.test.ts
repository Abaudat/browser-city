// `demo/citizens.ts`'s own pure fixture builder, tested against the real
// committed `client/public/demo-citizens.json` -- `tools/demo-citizens-
// build/tests/demo_citizens_fixture.rs`'s own generated output, the same
// "no hand-typed id" property the module doc comment claims. Body/eyes ids
// are cross-checked against the committed `defs/defs.json` so a stale
// fixture (regenerated defs, un-regenerated demo-citizens.json) fails
// here rather than silently.
import { describe, expect, it } from "vitest";
import {
  buildCitizenFixtures,
  buildPlayerAppearanceTuple,
  buildWalkerFixture,
  WALKER_ID,
  WALKER_LOOP,
} from "../../../src/demo/citizens";
import { committedDefs, committedDemoCitizens } from "./demo-world";

describe("buildCitizenFixtures", () => {
  const defs = committedDefs();
  const demoCitizens = committedDemoCitizens();
  const fixtures = buildCitizenFixtures(demoCitizens);
  const adults = fixtures.filter((f) => f.id.startsWith("adult-"));
  const kids = fixtures.filter((f) => f.id.startsWith("kid-"));

  it("builds at least 40 adults and at least 6 kids (Artie's crowd-size direction)", () => {
    expect(adults.length).toBeGreaterThanOrEqual(40);
    expect(kids.length).toBeGreaterThanOrEqual(6);
  });

  it("every tuple names a real id of the matching family in the committed defs", () => {
    const adultBodyIds = new Set(defs.bodies.filter((b) => b.family === "adult").map((b) => b.id));
    const kidBodyIds = new Set(defs.bodies.filter((b) => b.family === "kid").map((b) => b.id));
    for (const fixture of fixtures) {
      const isKid = fixture.id.startsWith("kid-");
      const bodyIds = isKid ? kidBodyIds : adultBodyIds;
      expect(bodyIds.has(fixture.tuple.body)).toBe(true);
    }
  });

  it("at least three citizens share one identical tuple (Tim's cache-reuse proof)", () => {
    const key = (t: (typeof adults)[number]["tuple"]) =>
      [t.body, t.eyes, t.outfit, t.hairstyle, t.accessory].join(",");
    const counts = new Map<string, number>();
    for (const fixture of fixtures) {
      const k = key(fixture.tuple);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(3);
  });

  it("the first two kids share one identical tuple, positioned side by side (Artie's twin pair)", () => {
    const first = kids[0];
    const second = kids[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.tuple).toEqual(second?.tuple);
    expect(Math.abs((first?.gridX ?? 0) - (second?.gridX ?? 0))).toBeLessThanOrEqual(2);
    expect(first?.gridY).toBe(second?.gridY);
  });

  it("exactly four adults declare the sanitation-worker profession (Artie's 'show 4' direction)", () => {
    const sanitationWorkers = fixtures.filter((f) => f.professionKey === "sanitation_worker");
    expect(sanitationWorkers).toHaveLength(4);
    for (const worker of sanitationWorkers) {
      expect(worker.id.startsWith("adult-")).toBe(true);
    }
  });

  it("no two fixtures declare the same id", () => {
    const ids = fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildWalkerFixture", () => {
  const defs = committedDefs();
  const demoCitizens = committedDemoCitizens();

  it("has the reserved walker id and an adult tuple naming real ids", () => {
    const walker = buildWalkerFixture(demoCitizens);
    expect(walker.id).toBe(WALKER_ID);
    const adultBodyIds = new Set(defs.bodies.filter((b) => b.family === "adult").map((b) => b.id));
    expect(adultBodyIds.has(walker.tuple.body)).toBe(true);
  });
});

describe("WALKER_LOOP", () => {
  it("visits all four axis directions (right, up, left, down) and returns to its start", () => {
    let x = 0;
    let y = 0;
    const directionsSeen = new Set<string>();
    for (const leg of WALKER_LOOP) {
      x += leg.dx;
      y += leg.dy;
      if (leg.dx > 0) directionsSeen.add("right");
      if (leg.dx < 0) directionsSeen.add("left");
      if (leg.dy < 0) directionsSeen.add("up");
      if (leg.dy > 0) directionsSeen.add("down");
    }
    expect(directionsSeen).toEqual(new Set(["right", "up", "left", "down"]));
    expect(x).toBe(0);
    expect(y).toBe(0);
  });
});

describe("buildPlayerAppearanceTuple", () => {
  it("names a real adult body id, distinct from the walker's own tuple", () => {
    const defs = committedDefs();
    const demoCitizens = committedDemoCitizens();
    const playerTuple = buildPlayerAppearanceTuple(demoCitizens);
    const walkerTuple = buildWalkerFixture(demoCitizens).tuple;
    const adultBodyIds = new Set(defs.bodies.filter((b) => b.family === "adult").map((b) => b.id));
    expect(adultBodyIds.has(playerTuple.body)).toBe(true);
    expect(playerTuple).not.toEqual(walkerTuple);
  });
});
