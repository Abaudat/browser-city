import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BodyLifecycle } from "../../../src/world/body-lifecycle";
import {
  type BodyCandidate,
  type BodyZone,
  bodyZoneOf,
  type Rect,
} from "../../../src/world/body-zone";

const VIEW: Rect = { x0: -20, y0: -11, x1: 20, y1: 11 };
const ZONE: BodyZone = bodyZoneOf(VIEW);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A lifecycle over counted hooks whose acquires the test settles by hand. */
function harness() {
  const pending: (Deferred<string> & { id: string })[] = [];
  const counts = { acquire: 0, release: 0, create: 0, destroy: 0 };
  const perId = new Map<string, number>();
  const created: { id: string; t: number }[] = [];
  const errors: string[] = [];
  const life = new BodyLifecycle<string, { id: string }>(
    {
      acquire: (id) => {
        counts.acquire++;
        perId.set(id, (perId.get(id) ?? 0) + 1);
        const d = { ...deferred<string>(), id };
        pending.push(d);
        // A rejected acquire holds no slot.
        d.promise.catch(() => perId.set(id, (perId.get(id) ?? 0) - 1));
        return d.promise;
      },
      release: (id) => {
        counts.release++;
        perId.set(id, (perId.get(id) ?? 0) - 1);
      },
      create: (id, _frames, t) => {
        counts.create++;
        created.push({ id, t });
        return { id };
      },
      destroy: () => {
        counts.destroy++;
      },
    },
    (id) => errors.push(id),
  );
  const at = (id: string, x: number, y = 0): BodyCandidate[] => [{ id, x, y, floor: 0 }];
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  return { life, pending, counts, perId, created, errors, at, flush };
}

const IN = 0;
const OUT = 10_000;

describe("BodyLifecycle", () => {
  it("builds no body before its frames resolve, and poses it at the spawn instant", async () => {
    const h = harness();
    h.life.apply(77, h.at("a", IN), 1, ZONE);
    expect(h.counts.create).toBe(0);
    expect(h.life.live.has("a")).toBe(true);
    h.pending[0]?.resolve("frames");
    await h.flush();
    expect(h.created).toEqual([{ id: "a", t: 77 }]);
    expect(h.life.bodies.has("a")).toBe(true);
  });

  it("a despawn while the acquire is pending releases exactly once and never builds a body", async () => {
    const h = harness();
    h.life.apply(0, h.at("a", IN), 1, ZONE);
    h.life.apply(1, h.at("a", OUT), 1, ZONE);
    expect(h.life.live.has("a")).toBe(false);
    h.pending[0]?.resolve("frames");
    await h.flush();
    expect(h.counts).toEqual({ acquire: 1, release: 1, create: 0, destroy: 0 });
    expect(h.life.bodies.size).toBe(0);
  });

  it("spawn, despawn, spawn while the first acquire is pending ends with one body, acquire and release balanced", async () => {
    const h = harness();
    h.life.apply(0, h.at("a", IN), 1, ZONE);
    h.life.apply(1, h.at("a", OUT), 1, ZONE);
    h.life.apply(2, h.at("a", IN), 1, ZONE);
    expect(h.pending).toHaveLength(2);
    h.pending[0]?.resolve("old");
    h.pending[1]?.resolve("new");
    await h.flush();
    expect(h.life.bodies.size).toBe(1);
    expect(h.counts.create).toBe(1);
    expect(h.counts.acquire - h.counts.release).toBe(1);
    expect(h.perId.get("a")).toBe(1);
  });

  it("a despawn of a built body destroys it and releases its slot once", async () => {
    const h = harness();
    h.life.apply(0, h.at("a", IN), 1, ZONE);
    h.pending[0]?.resolve("frames");
    await h.flush();
    h.life.apply(1, h.at("a", OUT), 1, ZONE);
    h.life.apply(2, h.at("a", OUT), 1, ZONE);
    expect(h.counts).toEqual({ acquire: 1, release: 1, create: 1, destroy: 1 });
  });

  it("a rejected acquire leaves no body, no unhandled rejection, and retries while in the zone", async () => {
    const h = harness();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    h.life.apply(0, h.at("a", IN), 1, ZONE);
    h.pending[0]?.reject(new Error("exhausted"));
    await h.flush();
    expect(h.errors).toEqual(["a"]);
    expect(h.life.live.has("a")).toBe(false);
    expect(h.counts.release).toBe(0);
    // Still in the zone: it asks again, and this time gets a body.
    h.life.apply(1, h.at("a", IN), 1, ZONE);
    expect(h.pending).toHaveLength(2);
    h.pending[1]?.resolve("frames");
    await h.flush();
    expect(h.life.bodies.has("a")).toBe(true);
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it("inv_far_citizen_has_no_body", async () => {
    const h = harness();
    const far: BodyCandidate[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `far-${i}`,
      x: 10_000 + i,
      y: -10_000 - i,
      floor: 0,
    }));
    for (let frame = 0; frame < 5; frame++) h.life.apply(frame, far, far.length, ZONE);
    await h.flush();
    expect(h.counts).toEqual({ acquire: 0, release: 0, create: 0, destroy: 0 });
    expect(h.life.live.size).toBe(0);
    expect(h.life.bodies.size).toBe(0);
  });

  it("inv_bodies_never_leak", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1 << 30 }), async (seed) => {
        let s = seed;
        const rnd = () => {
          s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
          return s / 0x1_0000_0000;
        };
        const h = harness();
        const crowd: BodyCandidate[] = Array.from({ length: 12 }, (_, i) => ({
          id: `c${i}`,
          x: OUT,
          y: 0,
          floor: 0,
        }));
        for (let step = 0; step < 300; step++) {
          for (const c of crowd) if (rnd() < 0.3) c.x = rnd() < 0.5 ? IN : OUT;
          h.life.apply(step, crowd, crowd.length, ZONE);
          // Settle a random subset of the pending acquires, some as failures.
          for (const d of h.pending.splice(0)) {
            const r = rnd();
            if (r < 0.5) d.resolve("f");
            else if (r < 0.65) d.reject(new Error("exhausted"));
            else h.pending.push(d);
          }
          await Promise.resolve();
          await Promise.resolve();
          for (const c of crowd) {
            // A slot is held by a built body or an acquire not yet landed.
            const waiting = h.pending.filter((p) => p.id === c.id).length;
            expect(h.perId.get(c.id) ?? 0).toBe((h.life.bodies.has(c.id) ? 1 : 0) + waiting);
          }
        }
        for (const d of h.pending.splice(0)) d.resolve("f");
        await h.flush();
        for (const c of crowd) c.x = OUT;
        h.life.apply(9999, crowd, crowd.length, ZONE);
        await h.flush();
        expect(h.life.bodies.size).toBe(0);
        expect(h.counts.release).toBe(h.counts.acquire - h.errors.length);
        for (const n of h.perId.values()) expect(n).toBe(0);
      }),
      { numRuns: 10 },
    );
  });
});
