import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createFlavourFrame,
  type FlavourDials,
  flavourAt,
  flavourBucketOf,
  flavourKindOf,
} from "../../../src/l3/flavour";
import type { Facing } from "../../../src/l3/gait";
import { SALTS, seedOf } from "../../../src/l3/seed";
import { l3Config } from "./defs-config";

const cfg = l3Config();
const dials: FlavourDials = {
  bucketMilliminutes: cfg.flavourBucketMilliminutes,
  glancePercent: cfg.flavourGlancePercent,
  glanceMilliminutes: cfg.flavourGlanceMilliminutes,
  idleFrameMilliminutes: cfg.idleFrameMilliminutes,
  idleFrames: 6,
};
const FACINGS: Facing[] = ["down", "up", "left", "right"];
const id = fc.string({ minLength: 1, maxLength: 16 });
const instant = fc.integer({ min: 0, max: 50_000_000 });
const facing = fc.constantFrom(...FACINGS);

function at(who: string, t: number, rest: Facing = "down", until = Number.POSITIVE_INFINITY) {
  const out = createFlavourFrame();
  flavourAt(who, t, rest, dials, until, out);
  return { ...out };
}

/** The first instant of `bucket` for `who`: its grid is shifted by an id offset. */
function findBucketStart(who: string, bucket: number): number {
  return (
    bucket * dials.bucketMilliminutes -
    (seedOf(who, SALTS.flavourOffset) % dials.bucketMilliminutes)
  );
}

describe("flavour (FR65, NFR26)", () => {
  it("inv_l3_flavour_is_a_pure_function_of_id_and_time", () => {
    fc.assert(
      fc.property(
        id,
        instant,
        facing,
        fc.array(instant, { maxLength: 20 }),
        (who, t, rest, hist) => {
          const warm = createFlavourFrame();
          for (const h of hist) flavourAt(who, h, rest, dials, Number.POSITIVE_INFINITY, warm);
          flavourAt(who, t, rest, dials, Number.POSITIVE_INFINITY, warm);
          const cold = at(who, t, rest);
          expect(Object.is(warm.direction, cold.direction)).toBe(true);
          expect(Object.is(warm.frameIndex, cold.frameIndex)).toBe(true);
          expect(Object.is(warm.glancing, cold.glancing)).toBe(true);
        },
      ),
    );
  });

  it("the kind is a function of (id, bucket) alone", () => {
    fc.assert(
      fc.property(id, fc.integer({ min: 1, max: 4000 }), fc.nat(9999), (who, bucket, nudge) => {
        const start = findBucketStart(who, bucket);
        expect(flavourBucketOf(who, start, dials)).toBe(bucket);
        expect(flavourBucketOf(who, start - 1, dials)).toBe(bucket - 1);
        const inside = start + (nudge % dials.bucketMilliminutes);
        expect(flavourBucketOf(who, inside, dials)).toBe(bucket);
        expect(flavourKindOf(who, bucket, dials)).toBe(flavourKindOf(who, bucket, dials));
      }),
    );
  });

  it("most buckets resolve to nothing", () => {
    let glances = 0;
    const draws = 4000;
    for (let i = 0; i < draws; i++) {
      if (flavourKindOf(`c${i % 40}`, Math.floor(i / 40), dials) === "glance") glances++;
    }
    const share = (glances / draws) * 100;
    expect(share).toBeGreaterThan(dials.glancePercent - 6);
    expect(share).toBeLessThan(dials.glancePercent + 6);
    expect(share).toBeLessThan(50);
  });

  it("a glance fits inside its bucket", () => {
    let seen = 0;
    for (let n = 0; n < 30; n++) {
      const who = `citizen-${n}`;
      for (let b = 1; b < 13; b++) {
        const start = findBucketStart(who, b);
        let first = -1;
        let last = -1;
        for (let t = start; t < start + dials.bucketMilliminutes; t += 100) {
          const f = at(who, t, "down");
          if (f.glancing) {
            expect(f.direction).not.toBe("down");
            if (first < 0) first = t;
            last = t;
          } else {
            expect(f.direction).toBe("down");
          }
        }
        if (first >= 0) {
          seen++;
          expect(last - first).toBeLessThanOrEqual(dials.glanceMilliminutes);
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  it("no glance is drawn that would not end before the next departure", () => {
    for (let n = 0; n < 60; n++) {
      for (let t = 0; t < 60_000; t += 137) {
        expect(at(`c${n}`, t, "up", t).glancing).toBe(false);
      }
    }
  });

  it("citizens do not gesture in unison", () => {
    const onsets = new Set<number>();
    for (let n = 0; n < 80; n++) {
      const who = `citizen-${n}`;
      for (let b = 1; b < 30; b++) {
        if (flavourKindOf(who, b, dials) !== "glance") continue;
        const start = findBucketStart(who, b);
        for (let t = start; t < start + dials.bucketMilliminutes; t += 5) {
          if (at(who, t).glancing) {
            onsets.add((t - start) / 5);
            break;
          }
        }
        break;
      }
    }
    expect(onsets.size).toBeGreaterThan(20);
  });

  it("the idle row plays on city time", () => {
    fc.assert(
      fc.property(id, instant, (who, t) => {
        const f = at(who, t);
        expect(f.frameIndex).toBeGreaterThanOrEqual(0);
        expect(f.frameIndex).toBeLessThan(dials.idleFrames);
      }),
    );
    const seen = new Set<number>();
    for (let t = 0; t < dials.idleFrameMilliminutes * dials.idleFrames; t++) {
      seen.add(at("c", t).frameIndex);
    }
    expect(seen.size).toBe(dials.idleFrames);
    const phases = new Set<number>();
    for (let n = 0; n < 60; n++) phases.add(at(`c${n}`, 0).frameIndex);
    expect(phases.size).toBeGreaterThan(3);
  });
});
