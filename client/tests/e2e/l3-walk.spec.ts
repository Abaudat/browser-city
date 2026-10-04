// Story 5.1 (FR63, FR64, NFR23): one L3 commuter on the real street, watched
// in a real browser. The drawn position is sampled in the page on every
// animation frame (never polled from Node), each sample carrying the city
// time it was posed at, so every bound is judged on the body's own timeline
// and not on when the sampler happened to run.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
// Pulls in `declare global { interface Window { __bc } }` -- types only.
import type {} from "../../src/net/e2e-hooks";

interface Sample {
  cityMilli: number;
  legKey: number;
  departAt: number;
  arriveAt: number;
  distance: number;
  x: number;
  y: number;
  animation: string;
  direction: string;
  frameIndex: number;
}

const defs = JSON.parse(readFileSync("public/defs/defs.json", "utf8")) as {
  real_ms_per_city_minute: number;
  balance: { key: string; value: number }[];
};
const balance = (key: string): number => {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key ${key}`);
  return entry.value;
};
const MS_PER_MILLI = defs.real_ms_per_city_minute / 1000;
const WALK_CELLS_PER_S = balance("movement.walk_speed_millicells_per_s") / 1000;
const BAND = balance("l3.walk_pace_band_percent") / 100;
const STALL_BOUND_MS = balance("l3.stall_bound_ms");
const FACING_HOLD_MS = balance("l3.facing_hold_ms");
const EARLY_BOUND = balance("l3.early_arrival_bound_milliminutes");

test("the commuter walks a leg on time, smoothly, in the walk row facing its travel", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForFunction(() => window.__bc?.commuterDrawn?.() !== undefined, undefined, {
    timeout: 20_000,
  });

  // Start recording where a leg is about to depart (the commuter stands at
  // an end between legs), then take every distinct posed frame for the leg.
  await page.waitForFunction(
    () => {
      const d = window.__bc?.commuterDrawn?.();
      return d !== undefined && d.distance === 0 && d.cityMilli < d.departAt - 100;
    },
    undefined,
    { timeout: 25_000, polling: "raf" },
  );
  const samples = await page.evaluate(
    (durationMs) =>
      new Promise<Sample[]>((resolve) => {
        const out: Sample[] = [];
        const end = performance.now() + durationMs;
        const tick = () => {
          const d = window.__bc?.commuterDrawn?.();
          const last = out[out.length - 1];
          if (d && (!last || d.cityMilli !== last.cityMilli)) out.push({ ...d });
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    14_000,
  );
  expect(samples.length).toBeGreaterThan(200);

  // Pick a leg observed from before it departs to after it arrives.
  const legs = new Map<number, Sample[]>();
  for (const s of samples) legs.set(s.legKey, [...(legs.get(s.legKey) ?? []), s]);
  const whole = [...legs.values()].find((l) => {
    const first = l[0];
    const last = l[l.length - 1];
    return !!first && !!last && first.cityMilli < first.departAt && last.cityMilli >= last.arriveAt;
  });
  expect(whole, "a whole leg inside the window").toBeDefined();
  if (!whole) return;
  const { departAt, arriveAt } = whole[0] as Sample;

  // On time: standing at the origin until depart, not yet at the destination
  // before arrive, at it (idle) from arrive on.
  const total = Math.max(...whole.map((s) => s.distance));
  for (const s of whole) {
    if (s.cityMilli < departAt) expect(s.distance).toBe(0);
    if (s.cityMilli < arriveAt - EARLY_BOUND) expect(s.distance).toBeLessThan(total);
    if (s.cityMilli >= arriveAt) expect(s.distance).toBe(total);
  }
  expect((whole[whole.length - 1] as Sample).animation).toBe("idle");

  // Smooth: per-frame displacement within the band's speed, progress never
  // backwards, no stationary stretch beyond the stall bound while walking,
  // the walk row facing the way it travels (a turn may lag by the hold).
  const maxCellsPerMs = (WALK_CELLS_PER_S * (1 + BAND) * 1.05) / 1000;
  let stationaryMs = 0;
  let turns = 0;
  let lastAxis = "";
  let sinceTurnMs = Number.POSITIVE_INFINITY;
  for (let i = 1; i < whole.length; i++) {
    const a = whole[i - 1] as Sample;
    const b = whole[i] as Sample;
    const dtMs = (b.cityMilli - a.cityMilli) * MS_PER_MILLI;
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    expect(moved).toBeLessThanOrEqual(maxCellsPerMs * dtMs + 1e-6);
    expect(b.distance).toBeGreaterThanOrEqual(a.distance);
    const walking = b.cityMilli > departAt && b.cityMilli < arriveAt;
    stationaryMs = walking && moved === 0 ? stationaryMs + dtMs : 0;
    expect(stationaryMs).toBeLessThanOrEqual(STALL_BOUND_MS);
    sinceTurnMs += dtMs;
    if (moved === 0) continue;
    // The frame that lands on the destination is the first idle one.
    if (b.cityMilli >= arriveAt) continue;
    expect(b.animation).toBe("walk");
    const horizontal = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
    const axis = horizontal ? "x" : "y";
    if (lastAxis && axis !== lastAxis) {
      turns++;
      sinceTurnMs = 0;
    }
    lastAxis = axis;
    const expected = horizontal ? (b.x > a.x ? "right" : "left") : b.y > a.y ? "down" : "up";
    // A frame that spans the corner itself moves along both axes: the facing
    // is judged on the frames with a single axis of travel.
    const straight = Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) < 1e-9;
    if (straight && sinceTurnMs > FACING_HOLD_MS + 50) expect(b.direction).toBe(expected);
  }
  expect(turns, "the route turns at least twice").toBeGreaterThanOrEqual(2);
  const frames = new Set(whole.filter((s) => s.animation === "walk").map((s) => s.frameIndex));
  expect(frames.size).toBe(6);
});
