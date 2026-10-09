import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createFlavourFrame,
  type FlavourDials,
  type FlavourRow,
  flavourAt,
  flavourBucketOf,
  flavourKindOf,
} from "../../../src/l3/flavour";
import type { Facing } from "../../../src/l3/gait";
import { SALTS, seedOf } from "../../../src/l3/seed";
import { lifeDials } from "./defs-config";

const dials: FlavourDials = lifeDials();
const glance = dials.rows[0] as FlavourRow;
const GLANCE = "glance";
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
          expect(Object.is(warm.flavour, cold.flavour)).toBe(true);
          expect(Object.is(warm.animation, cold.animation)).toBe(true);
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
      if (flavourKindOf(`c${i % 40}`, Math.floor(i / 40), dials) === GLANCE) glances++;
    }
    const share = (glances / draws) * 100;
    expect(share).toBeGreaterThan(glance.weightPercent - 6);
    expect(share).toBeLessThan(glance.weightPercent + 6);
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
          if (f.flavour) {
            expect(f.direction).not.toBe("down");
            if (first < 0) first = t;
            last = t;
          } else {
            expect(f.direction).toBe("down");
          }
        }
        if (first >= 0) {
          seen++;
          expect(last - first).toBeLessThanOrEqual(glance.durationMilliminutes);
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  it("no glance is drawn that would not end before the next departure", () => {
    for (let n = 0; n < 60; n++) {
      for (let t = 0; t < 60_000; t += 137) {
        expect(at(`c${n}`, t, "up", t).flavour).toBe("");
      }
    }
  });

  it("citizens do not gesture in unison", () => {
    const onsets = new Set<number>();
    for (let n = 0; n < 80; n++) {
      const who = `citizen-${n}`;
      for (let b = 1; b < 30; b++) {
        if (flavourKindOf(who, b, dials) !== GLANCE) continue;
        const start = findBucketStart(who, b);
        for (let t = start; t < start + dials.bucketMilliminutes; t += 5) {
          if (at(who, t).flavour) {
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
        expect(f.frameIndex).toBeLessThan(dials.frames.idle as number);
      }),
    );
    const seen = new Set<number>();
    for (let t = 0; t < dials.idleFrameMilliminutes * (dials.frames.idle as number); t++) {
      seen.add(at("c", t).frameIndex);
    }
    expect(seen.size).toBe(dials.frames.idle as number);
    const phases = new Set<number>();
    for (let n = 0; n < 60; n++) phases.add(at(`c${n}`, 0).frameIndex);
    expect(phases.size).toBeGreaterThan(3);
  });

  it("selection is a weighted draw over the catalogue's eligible rows, nothing the remainder", () => {
    const reading: FlavourRow = {
      id: "reading",
      weightPercent: 30,
      durationMilliminutes: 2000,
      animation: "read",
      facing: "rest",
    };
    const both: FlavourDials = { ...dials, rows: [glance, reading], frames: { idle: 6, read: 4 } };
    const without: FlavourDials = { ...both, frames: { idle: 6 } };
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const kind = flavourKindOf(`c${i % 60}`, Math.floor(i / 60), both);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      // A citizen with no `read` row anywhere is never drawn reading.
      expect(flavourKindOf(`c${i % 60}`, Math.floor(i / 60), without)).not.toBe("reading");
    }
    const share = (kind: string) => ((counts.get(kind) ?? 0) / 6000) * 100;
    expect(Math.abs(share("reading") - 30)).toBeLessThan(5);
    expect(Math.abs(share("glance") - glance.weightPercent)).toBeLessThan(5);
    expect(share("")).toBeGreaterThan(30);
  });

  it("a row plays its own animation and keeps the rest facing when it says so", () => {
    const reading: FlavourRow = {
      id: "reading",
      weightPercent: 100,
      durationMilliminutes: 2000,
      animation: "read",
      facing: "rest",
    };
    const only: FlavourDials = { ...dials, rows: [reading], frames: { idle: 6, read: 4 } };
    let seen = 0;
    for (let t = 0; t < 40_000; t += 50) {
      const out = createFlavourFrame();
      flavourAt("c", t, "up", only, Number.POSITIVE_INFINITY, out);
      if (out.flavour === "reading") {
        seen++;
        expect(out.animation).toBe("read");
        expect(out.direction).toBe("up");
        expect(out.frameIndex).toBeLessThan(4);
      } else {
        expect(out.animation).toBe("idle");
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});
