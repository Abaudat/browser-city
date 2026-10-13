import { describe, expect, it } from "vitest";
import {
  buildPlayerAppearanceTuple,
  PLAYER_LOOK_INDEX,
  tupleFor,
} from "../../../../src/render/appearance/player-look";
import { committedDefs } from "../../support/committed-defs";

const defs = committedDefs();

describe("tupleFor", () => {
  it("is a pure function of the family and index", () => {
    expect(tupleFor(defs, "adult", 7)).toEqual(tupleFor(defs, "adult", 7));
    expect(tupleFor(defs, "adult", 7)).not.toEqual(tupleFor(defs, "adult", 8));
  });

  it("picks only civilian parts of its own family", () => {
    for (const family of ["adult", "kid"] as const) {
      for (let i = 0; i < 60; i++) {
        const t = tupleFor(defs, family, i);
        const body = defs.bodies.find((b) => b.id === t.body);
        expect(body?.family).toBe(family);
        expect(body?.pool).toBe("civilian");
        expect(defs.eyes.find((e) => e.id === t.eyes)?.pool).toBe("civilian");
        expect(defs.outfits.find((o) => o.id === t.outfit)?.pool).toBe("civilian");
      }
    }
  });

  it("gives a kid no accessory, and an adult one only sometimes", () => {
    const kids = Array.from({ length: 80 }, (_, i) => tupleFor(defs, "kid", i).accessory);
    expect(new Set(kids)).toEqual(new Set([0]));
    const adults = Array.from({ length: 200 }, (_, i) => tupleFor(defs, "adult", i).accessory);
    expect(adults.some((a) => a === 0)).toBe(true);
    expect(adults.some((a) => a !== 0)).toBe(true);
  });

  it("draws the rare hair of a family now and then, and the common most of the time", () => {
    const rare = new Set(defs.hairstyles.filter((h) => h.rare).map((h) => h.id));
    const picks = Array.from({ length: 400 }, (_, i) => tupleFor(defs, "adult", i).hairstyle);
    const rareCount = picks.filter((id) => rare.has(id)).length;
    expect(rareCount).toBeGreaterThan(0);
    expect(rareCount).toBeLessThan(picks.length / 2);
  });

  it("refuses a defs document with no civilian parts, naming the family", () => {
    const empty = { ...defs, bodies: [], eyes: [], outfits: [] };
    expect(() => tupleFor(empty, "adult", 0)).toThrow(/adult/);
  });

  it("refuses a defs document missing the appearance balance keys", () => {
    expect(() => tupleFor({ ...defs, balance: [] }, "adult", 0)).toThrow(/balance entry/);
  });
});

describe("buildPlayerAppearanceTuple", () => {
  it("is the tuple at the player's own look index", () => {
    expect(buildPlayerAppearanceTuple(defs)).toEqual(tupleFor(defs, "adult", PLAYER_LOOK_INDEX));
  });
});
