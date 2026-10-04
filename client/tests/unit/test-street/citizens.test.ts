// `test-street/citizens.ts`'s own pure fixture builder, tested against the real
// committed `client/public/defs/defs.json` -- the same "no hand-typed
// id" property the module doc comment claims.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ZOOM } from "../../../src/render/camera";
import { worldPointPx } from "../../../src/render/screen-position";
import {
  buildCitizenFixtures,
  buildPlayerAppearanceTuple,
  buildUniformedWalkerFixture,
  buildWalkerFixture,
  CROWD_FLOOR,
  UNIFORMED_WALKER_ID,
  WALKER_ID,
  WALKER_SPECS,
} from "../../../src/test-street/citizens";
import {
  buildTimetable,
  createWalkerFrame,
  TimetableWalker,
} from "../../../src/test-street/timetable";
import { l3Config } from "../l3/defs-config";
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

describe("WALKER_SPECS", () => {
  it("gives each walker an L-shaped route on the crowd's own pavement", () => {
    for (const id of [WALKER_ID, UNIFORMED_WALKER_ID]) {
      const spec = WALKER_SPECS[id];
      expect(spec?.out.length).toBeGreaterThanOrEqual(3);
      expect(spec?.out.every((c) => c.floor === CROWD_FLOOR)).toBe(true);
    }
  });
});

// `citizens.ts` no longer has its own screen-space placement function
// (story 15.4, Tim's direction): the crowd is placed through the one
// shared `worldPointPx` projection, at `CROWD_FLOOR` (always 0, so
// `storeyHeightPx` never matters here) -- the same call
// `citizens-layer.ts` makes.
describe("crowd placement through worldPointPx", () => {
  const tile = committedDefs().balance.find((b) => b.key === "render.tile_size_px")?.value ?? 0;
  const storey =
    committedDefs().balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
  const crowdScreenPx = (x: number, y: number, tileSizePx: number, zoom: number) =>
    worldPointPx(x, y, CROWD_FLOOR, tileSizePx, storey, zoom);

  // A walker's drawn position, frame by frame at a constant delta: whole
  // screen pixels at every zoom.
  it("draws an L3 walker at whole screen pixels", () => {
    const config = l3Config();
    const walkerSpec = WALKER_SPECS[WALKER_ID];
    if (!walkerSpec) throw new Error("no walker spec");
    const timetable = buildTimetable(walkerSpec, config);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 4, max: 60 }),
        fc.constantFrom(ZOOM, 1, 2, 4),
        fc.constantFrom(tile, 8, 16, 32),
        (startMilli, deltaMS, zoom, tileSizePx) => {
          const walker = new TimetableWalker(
            timetable,
            { revision: () => 0, walkable: () => true },
            { marginCells: config.marginCells, nodeBudget: config.nodeBudget },
            config,
            WALKER_ID,
          );
          const frame = createWalkerFrame();
          const stepMilli = (deltaMS * 1000) / config.realMsPerCityMinute;
          for (let k = 0; k < 300; k++) {
            walker.frameAt(startMilli + k * stepMilli, frame);
            const px = crowdScreenPx(frame.x, frame.y, tileSizePx, zoom);
            expect(Math.abs(px.x * zoom - Math.round(px.x * zoom))).toBeLessThan(1e-6);
            expect(Math.abs(px.y * zoom - Math.round(px.y * zoom))).toBeLessThan(1e-6);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("refuses a non-integer zoom", () => {
    expect(() => crowdScreenPx(1, 1, 16, 2.5)).toThrow(/zoom/);
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
