// `test-street/citizens.ts`'s own pure fixture builder, tested against the real
// committed `client/public/defs/defs.json` -- the same "no hand-typed
// id" property the module doc comment claims.
import { describe, expect, it } from "vitest";
import {
  buildCitizenFixtures,
  buildPlayerAppearanceTuple,
  buildUniformedWalkerFixture,
  buildWalkerFixture,
  UNIFORMED_WALKER_ID,
  WALK_CELLS_PER_SECOND,
  WALK_FRAMES_PER_DIRECTION,
  WALK_FRAMES_PER_SECOND,
  WALKER_ID,
  WALKER_LOOP,
  walkerPoseAt,
} from "../../../src/test-street/citizens";
import { committedDefs } from "./street-world";

describe("buildCitizenFixtures", () => {
  const defs = committedDefs();
  const fixtures = buildCitizenFixtures(defs);
  const adults = fixtures.filter((f) => f.id.startsWith("adult-"));
  const kids = fixtures.filter((f) => f.id.startsWith("kid-"));

  it("builds exactly 40 adults and 6 kids (Artie's crowd-size direction)", () => {
    expect(adults).toHaveLength(40);
    expect(kids).toHaveLength(6);
  });

  it("every tuple's body/eyes/outfit names a real civilian-pool id of the matching family", () => {
    for (const fixture of fixtures) {
      const family = fixture.id.startsWith("kid-") ? "kid" : "adult";
      const civilianBodyIds = new Set(
        defs.bodies.filter((b) => b.family === family && b.pool === "civilian").map((b) => b.id),
      );
      const civilianEyesIds = new Set(
        defs.eyes.filter((e) => e.family === family && e.pool === "civilian").map((e) => e.id),
      );
      const civilianOutfitIds = new Set(
        defs.outfits.filter((o) => o.family === family && o.pool === "civilian").map((o) => o.id),
      );
      expect(civilianBodyIds.has(fixture.tuple.body)).toBe(true);
      expect(civilianEyesIds.has(fixture.tuple.eyes)).toBe(true);
      expect(civilianOutfitIds.has(fixture.tuple.outfit)).toBe(true);
    }
  });

  it("a non-zero accessory always names a real civilian-pool id of the matching family", () => {
    for (const fixture of fixtures) {
      if (fixture.tuple.accessory === 0) continue;
      const family = fixture.id.startsWith("kid-") ? "kid" : "adult";
      const civilianAccessoryIds = new Set(
        defs.accessories
          .filter((a) => a.family === family && a.pool === "civilian")
          .map((a) => a.id),
      );
      expect(civilianAccessoryIds.has(fixture.tuple.accessory)).toBe(true);
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

  it("one adult stands beside kid-0 on the identical foot line (the close-crop pairing)", () => {
    const kid0 = kids[0];
    expect(kid0).toBeDefined();
    const neighbour = adults.find((a) => a.gridY === kid0?.gridY);
    expect(neighbour).toBeDefined();
    expect(Math.abs((neighbour?.gridX ?? 0) - (kid0?.gridX ?? 0))).toBeLessThanOrEqual(2);
  });

  it("exactly four adults declare the sanitation-worker profession (Artie's 'show 4' direction)", () => {
    const sanitationWorkers = fixtures.filter((f) => f.professionKey === "sanitation_worker");
    expect(sanitationWorkers).toHaveLength(4);
    for (const worker of sanitationWorkers) {
      expect(worker.id.startsWith("adult-")).toBe(true);
    }
  });

  it("three adult pairs stand one tile apart, facing each other (the talking vignettes)", () => {
    const facingPairs = [
      ["adult-1", "adult-2"],
      ["adult-3", "adult-4"],
      ["adult-5", "adult-6"],
    ] as const;
    for (const [aId, bId] of facingPairs) {
      const a = fixtures.find((f) => f.id === aId);
      const b = fixtures.find((f) => f.id === bId);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      const distance = Math.hypot(
        (a?.gridX ?? 0) - (b?.gridX ?? 0),
        (a?.gridY ?? 0) - (b?.gridY ?? 0),
      );
      expect(distance).toBeCloseTo(1, 5);
      expect(a?.facing === "right" && b?.facing === "left").toBe(true);
    }
  });

  it("no two citizens stand closer than one tile apart", () => {
    for (let i = 0; i < fixtures.length; i++) {
      for (let j = i + 1; j < fixtures.length; j++) {
        const a = fixtures[i];
        const b = fixtures[j];
        if (!a || !b) continue;
        const distance = Math.hypot(a.gridX - b.gridX, a.gridY - b.gridY);
        expect(distance).toBeGreaterThanOrEqual(1 - 1e-6);
      }
    }
  });

  it("no two fixtures declare the same id", () => {
    const ids = fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("accessories are hashed per citizen, not a repeating pattern (Artie's crowd-variety direction)", () => {
    // `accessory_none_chance` (`defs/balance/citizen.toml`) is 70: about
    // 70% of adults should carry no accessory at all, and no single
    // accessory id should stand out as a uniform (everyone wearing the
    // same cap reads as a lookup table, not a population). Bounds below
    // are deliberately loose around that ~30%-with-an-accessory
    // expectation -- this is a hash over 40 draws, not a fair-coin
    // guarantee -- but tight enough to catch a stride or a low-variety
    // pool leaking through as visible repetition.
    const accessoryCounts = new Map<number, number>();
    let adultsWithAccessory = 0;
    for (const adult of adults) {
      if (adult.tuple.accessory === 0) continue;
      adultsWithAccessory++;
      accessoryCounts.set(
        adult.tuple.accessory,
        (accessoryCounts.get(adult.tuple.accessory) ?? 0) + 1,
      );
    }
    // adults.length is 40 (asserted above): 30% expected-with-accessory
    // + 30 points of tolerance (a hash over 40 draws, not a fair coin) =
    // at most 60% (24 of 40) -- still well short of "almost everyone",
    // which is the pattern this test exists to catch.
    expect(adultsWithAccessory).toBeLessThanOrEqual(Math.ceil(adults.length * 0.6));
    for (const count of accessoryCounts.values()) {
      expect(count).toBeLessThanOrEqual(3);
    }
  });
});

describe("buildWalkerFixture / buildUniformedWalkerFixture", () => {
  const defs = committedDefs();

  it("has the reserved walker id and an adult tuple naming a real civilian id", () => {
    const walker = buildWalkerFixture(defs);
    expect(walker.id).toBe(WALKER_ID);
    const civilianAdultBodyIds = new Set(
      defs.bodies.filter((b) => b.family === "adult" && b.pool === "civilian").map((b) => b.id),
    );
    expect(civilianAdultBodyIds.has(walker.tuple.body)).toBe(true);
  });

  it("the uniformed walker wears the sanitation-worker override and a distinct tuple", () => {
    const walker = buildWalkerFixture(defs);
    const uniformed = buildUniformedWalkerFixture(defs);
    expect(uniformed.id).toBe(UNIFORMED_WALKER_ID);
    expect(uniformed.professionKey).toBe("sanitation_worker");
    expect(uniformed.tuple).not.toEqual(walker.tuple);
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

describe("walkerPoseAt", () => {
  it("stays at the start with the right-leg's frame 0 at elapsedMS 0", () => {
    const pose = walkerPoseAt(10, 20, 0);
    expect(pose.x).toBe(10);
    expect(pose.y).toBe(20);
    expect(pose.direction).toBe("right");
    expect(pose.frameIndex).toBe(0);
  });

  it("returns to the exact start position after one full loop", () => {
    const legDurationsMS = WALKER_LOOP.map(
      (leg) => (Math.hypot(leg.dx, leg.dy) / WALK_CELLS_PER_SECOND) * 1000,
    );
    const loopDurationMS = legDurationsMS.reduce((sum, ms) => sum + ms, 0);
    const pose = walkerPoseAt(5, 5, loopDurationMS);
    expect(pose.x).toBeCloseTo(5, 6);
    expect(pose.y).toBeCloseTo(5, 6);
    expect(pose.direction).toBe("right");
  });

  it("is exactly at the first corner, facing up, right after the right leg finishes", () => {
    const rightLeg = WALKER_LOOP[0];
    if (!rightLeg) throw new Error("WALKER_LOOP has no first leg");
    const rightLegMS = (Math.hypot(rightLeg.dx, rightLeg.dy) / WALK_CELLS_PER_SECOND) * 1000;
    const pose = walkerPoseAt(0, 0, rightLegMS);
    expect(pose.x).toBeCloseTo(rightLeg.dx, 6);
    expect(pose.y).toBeCloseTo(rightLeg.dy, 6);
    expect(pose.direction).toBe("up");
  });

  it("cycles its frame index over WALK_FRAMES_PER_DIRECTION, at WALK_FRAMES_PER_SECOND", () => {
    const msPerFrame = 1000 / WALK_FRAMES_PER_SECOND;
    expect(walkerPoseAt(0, 0, 0).frameIndex).toBe(0);
    expect(walkerPoseAt(0, 0, msPerFrame).frameIndex).toBe(1);
    expect(walkerPoseAt(0, 0, msPerFrame * WALK_FRAMES_PER_DIRECTION).frameIndex).toBe(0);
  });
});

describe("buildPlayerAppearanceTuple", () => {
  it("names a real civilian adult body id, distinct from either walker's own tuple", () => {
    const defs = committedDefs();
    const playerTuple = buildPlayerAppearanceTuple(defs);
    const walkerTuple = buildWalkerFixture(defs).tuple;
    const uniformedWalkerTuple = buildUniformedWalkerFixture(defs).tuple;
    const civilianAdultBodyIds = new Set(
      defs.bodies.filter((b) => b.family === "adult" && b.pool === "civilian").map((b) => b.id),
    );
    expect(civilianAdultBodyIds.has(playerTuple.body)).toBe(true);
    expect(playerTuple).not.toEqual(walkerTuple);
    expect(playerTuple).not.toEqual(uniformedWalkerTuple);
  });
});
