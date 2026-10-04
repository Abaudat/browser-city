// Story 5.1 (FR63, FR64, NFR23): one L3 commuter on the real street, watched
// in a real browser. The drawn state is sampled in the page on every animation
// frame (never polled from Node). Each sample carries the city time the body
// was posed at, the real time it was read at, where the sprite is drawn and
// where it came out in the street floor's depth order, so a bound can be
// judged on the body's own timeline, on the real clock, and on what is on the
// screen.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
// Pulls in `declare global { interface Window { __bc } }` -- types only.
import type {} from "../../src/net/e2e-hooks";
import { ZOOM } from "../../src/render/camera";
import { worldPointPx } from "../../src/render/screen-position";

interface Sample {
  realMs: number;
  cityMilli: number;
  legKey: number;
  departAt: number;
  arriveAt: number;
  distance: number;
  x: number;
  y: number;
  floor: number;
  orderIndex: number;
  lamppostOrderIndex: number;
  screenX: number;
  screenY: number;
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
const EARLY_BOUND = balance("l3.early_arrival_bound_milliminutes");
const TILE_SIZE_PX = balance("render.tile_size_px");
const STOREY_HEIGHT_PX = balance("render.storey_height_px");

/** The real walk may differ from the leg's duration by this fraction (frame
 * granularity at both ends, and the slewed clock). */
const REAL_TIME_TOLERANCE = 0.1;

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
          if (d && (!last || d.cityMilli !== last.cityMilli)) {
            out.push({ ...d, realMs: performance.now() });
          }
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    9_000,
  );
  expect(samples.length).toBeGreaterThan(100);

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

  // On the real clock: the walk, first walking frame to first idle frame
  // after it, takes the leg's duration in real time -- a city clock running
  // slow or stalling would pass every bound on the body's own timeline.
  const firstWalking = whole.find((s) => s.animation === "walk") as Sample;
  const arrived = whole.find((s) => s.cityMilli >= arriveAt) as Sample;
  const legRealMs = (arriveAt - departAt) * MS_PER_MILLI;
  const realMs = arrived.realMs - firstWalking.realMs;
  expect(Math.abs(realMs - legRealMs) / legRealMs).toBeLessThan(REAL_TIME_TOLERANCE);

  // Drawn where the pose says, in whole screen pixels, and in the right depth
  // order against the lamppost.
  for (const s of whole) {
    const px = worldPointPx(s.x, s.y, s.floor, TILE_SIZE_PX, STOREY_HEIGHT_PX, ZOOM, 0);
    expect(s.screenX).toBe(px.x);
    expect(s.screenY).toBe(px.y);
    expect(Number.isInteger(s.screenX * ZOOM)).toBe(true);
    expect(Number.isInteger(s.screenY * ZOOM)).toBe(true);
    expect(s.orderIndex).toBeGreaterThanOrEqual(0);
    expect(s.lamppostOrderIndex).toBeGreaterThanOrEqual(0);
    // The lamppost's feet are on row 8's bottom edge; the commuter's are on a
    // row centre above it: it is drawn behind the lamppost.
    if (s.y < 9) expect(s.orderIndex).toBeLessThan(s.lamppostOrderIndex);
  }

  // Smooth: per-frame displacement within the band's speed, progress never
  // backwards, no stationary stretch beyond the stall bound while walking,
  // and the walk row facing the way it travels.
  const maxCellsPerMs = (WALK_CELLS_PER_S * (1 + BAND) * 1.05) / 1000;
  let stationaryMs = 0;
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
    if (moved === 0 || b.cityMilli >= arriveAt) continue;
    expect(b.animation).toBe("walk");
    // Facing is a function of the path: the dominant axis of the travel.
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const expected = horizontal ? (b.x >= a.x ? "right" : "left") : b.y > a.y ? "down" : "up";
    // A frame that spans a bend moves along two axes; judge the straight ones.
    const straight = Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) < 1e-9;
    if (straight) expect(b.direction).toBe(expected);
  }
  const frames = new Set(whole.filter((s) => s.animation === "walk").map((s) => s.frameIndex));
  expect(frames.size).toBe(6);
});
