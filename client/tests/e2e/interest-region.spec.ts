// Story 4.3 (FR136, FR58, FR145): interest management proven with the real
// client against the real module, at exactly the places a unit test with a
// fake cannot reach -- the bytes the client really puts on the WebSocket
// and the rows its SDK cache really ends up holding.
//
// The e2e world is seeded by `spacetime-harness.mjs` (through the module's
// own owner-only restore path): one `placed_object` and one
// `actor_location` in every chunk of a 9x9 block, far more than any one
// region. Everything derivable below the browser -- the region maths, the
// handle accounting, the hysteresis, the query literals -- is property-
// tested in `tests/unit/` and `scripts/ci/check-interest-region.sh`; this
// file holds only what needs a browser. No `waitForTimeout`: every wait is
// on an observable condition.
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { computeCamera, ZOOM } from "../../src/render/camera";
import { visibleCellBounds, worldPointPx } from "../../src/render/screen-position";
import { CHUNK_SIZE, chunkKey } from "../../src/world/chunk";
import { columnOf, REGION_LEAVE_RADIUS_CHUNKS, REGION_RADIUS_CHUNKS } from "../../src/world/region";
import { E2E_WORLD, readSpacetimeHandle } from "./spacetime-harness.mjs";

const TILE = 16;
const STOREY = 48;
const INITIAL_HANDLES = (2 * REGION_RADIUS_CHUNKS + 1) ** 2;
const SPATIAL = [
  "placed_object",
  "floor_transition",
  "building_area",
  "room_area",
  "actor_location",
];

/** A chunk that is held before and after the crossing below. */
const STAY = { cx: 1, cy: 0 };
/** A chunk held at the start, still held at the boundary, gone past the hysteresis distance. */
const LEFT_BEHIND = { cx: -2, cy: 0 };
/** Well outside any region the spawn could ever ask for. */
const FAR = { cx: 4, cy: 4 };

const keyOf = (c: { cx: number; cy: number }): string =>
  String(chunkKey(c.cx * CHUNK_SIZE, c.cy * CHUNK_SIZE, 0));
const objectId = (c: { cx: number; cy: number }): string =>
  `placedObject:${E2E_WORLD.idOf(c.cx, c.cy)}`;

async function initialRegionApplied(page: Page): Promise<void> {
  await page.waitForFunction(
    (n) => (window.__bc?.region?.applied().length ?? 0) >= n,
    INITIAL_HANDLES,
    { timeout: 20_000 },
  );
}

test("every spatial subscription on the wire carries a chunk predicate, and the far world never enters the client cache", async ({
  page,
}) => {
  const handle = readSpacetimeHandle();
  const dbWsPrefix = handle.serverUrl.replace(/^http/, "ws");
  const sentQueries: string[] = [];
  page.on("websocket", (ws) => {
    if (!ws.url().startsWith(dbWsPrefix)) return; // never Vite's own HMR socket
    ws.on("framesent", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString("latin1");
      for (const m of text.matchAll(
        /SELECT \* FROM "[a-z_]+"(?: WHERE "[a-z_]+"\."[a-z_]+" = \d+)?/g,
      )) {
        sentQueries.push(m[0]);
      }
    });
  });

  await page.goto("/");
  await initialRegionApplied(page);

  // Every spatial query names a chunk_key equality; none is a whole table.
  const spatial = sentQueries.filter((q) => SPATIAL.some((t) => q.includes(`FROM "${t}"`)));
  expect(spatial.length).toBe(INITIAL_HANDLES * SPATIAL.length * 8); // 8 floors in the ground band
  for (const q of spatial) expect(q).toMatch(/WHERE "[a-z_]+"\."chunk_key" = \d+$/);
  // The whole-table queries are the three global singletons, nothing else.
  const whole = sentQueries.filter((q) => !q.includes("WHERE"));
  expect(new Set(whole)).toEqual(
    new Set([
      'SELECT * FROM "demo_ping"',
      'SELECT * FROM "module_version"',
      'SELECT * FROM "world_clock"',
    ]),
  );

  // The sentinel in a far chunk never reaches the cache, and what does is
  // exactly the 5x5 around the spawn.
  const cached = await page.evaluate(() => window.__bc?.region?.cachedChunkKeys("placedObject"));
  expect(cached).not.toContain(keyOf(FAR));
  expect(cached?.length).toBe(INITIAL_HANDLES);
  expect(cached).toContain(keyOf(STAY));
  expect(cached).toContain(keyOf(LEFT_BEHIND));
});

test("walking across a chunk boundary: every chunk the viewport shows is applied, the shared chunk never pops, the left-behind chunk goes only past the hysteresis distance", async ({
  page,
}) => {
  await page.goto("/");
  await initialRegionApplied(page);
  const stay = objectId(STAY);
  const left = objectId(LEFT_BEHIND);

  const before = await page.evaluate(() => ({
    inserts: window.__bc?.region?.inserts ?? {},
    deletes: window.__bc?.region?.deletes ?? {},
  }));
  expect(before.inserts[stay]).toBe(1);
  expect(before.inserts[left]).toBe(1);

  // The chunk columns the viewport intersects at each sampled position,
  // from the renderer's own `visibleCellBounds` -- never a second
  // derivation of the viewport.
  const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const startX = 26;
  const endX = 40;
  const y = 4;
  const path: { x: number; required: string[] }[] = [];
  for (let x = startX; x <= endX; x += 0.25) {
    const p = worldPointPx(x, y, 0, TILE, STOREY, ZOOM);
    const camera = computeCamera(p.x, p.y, size.w, size.h, ZOOM);
    const b = visibleCellBounds(size.w, size.h, camera, 0, TILE, STOREY);
    const lo = columnOf(b.cellX0, b.cellY0);
    const hi = columnOf(b.cellX1, b.cellY1);
    const required: string[] = [];
    for (let cx = lo.cx; cx <= hi.cx; cx++) {
      for (let cy = lo.cy; cy <= hi.cy; cy++) required.push(`${cx},${cy},0`);
    }
    path.push({ x, required });
  }

  // Walk at the canonical speed, one sample per animation frame.
  const walkSpeedCellsPerS = 2.2;
  const missing = await page.evaluate(
    ({ path, y, speed }) =>
      new Promise<string[]>((resolve) => {
        const bad: string[] = [];
        const t0 = performance.now();
        const x0 = path[0]?.x ?? 0;
        const tick = () => {
          const x = x0 + ((performance.now() - t0) / 1000) * speed;
          const last = path[path.length - 1]?.x ?? x0;
          const step = path[Math.min(path.length - 1, Math.max(0, Math.round((x - x0) / 0.25)))];
          window.__bc?.region?.moveTo(Math.min(x, last), y, 0);
          const applied = new Set(window.__bc?.region?.applied() ?? []);
          for (const id of step?.required ?? []) {
            if (!applied.has(id)) bad.push(`x=${x.toFixed(2)} missing ${id}`);
          }
          if (x >= last) resolve(bad);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { path, y, speed: walkSpeedCellsPerS },
  );
  expect(missing).toEqual([]);

  // Past the boundary, in column 1: the new columns arrive and settle.
  await page.waitForFunction(
    (n) => {
      const r = window.__bc?.region;
      return !!r && r.applied().length >= n && r.liveHandles() === r.held().length;
    },
    INITIAL_HANDLES + (2 * REGION_RADIUS_CHUNKS + 1),
    { timeout: 20_000 },
  );

  // A chunk held before and after was never released and re-fetched.
  const mid = await page.evaluate(() => ({
    inserts: window.__bc?.region?.inserts ?? {},
    deletes: window.__bc?.region?.deletes ?? {},
    held: window.__bc?.region?.held() ?? [],
    cached: window.__bc?.region?.cachedChunkKeys("placedObject") ?? [],
  }));
  expect(mid.inserts[stay]).toBe(1);
  expect(mid.deletes[stay] ?? 0).toBe(0);
  // The chunk left behind is still held at the boundary...
  expect(mid.held).toContain(`${LEFT_BEHIND.cx},${LEFT_BEHIND.cy},0`);
  expect(mid.cached).toContain(keyOf(LEFT_BEHIND));
  expect(mid.deletes[left] ?? 0).toBe(0);
  expect(LEFT_BEHIND.cx - columnOf(endX, y).cx).toBe(-REGION_LEAVE_RADIUS_CHUNKS);

  // ...and gone only past the hysteresis distance.
  await page.evaluate((x) => window.__bc?.region?.moveTo(x, 4, 0), 2 * CHUNK_SIZE + 1);
  await page.waitForFunction(
    (id) => !(window.__bc?.region?.held() ?? []).includes(id),
    `${LEFT_BEHIND.cx},${LEFT_BEHIND.cy},0`,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    (key) => !(window.__bc?.region?.cachedChunkKeys("placedObject") ?? []).includes(key),
    keyOf(LEFT_BEHIND),
    { timeout: 20_000 },
  );
  const after = await page.evaluate(() => ({
    deletes: window.__bc?.region?.deletes ?? {},
    cached: window.__bc?.region?.cachedChunkKeys("placedObject") ?? [],
  }));
  expect(after.deletes[left]).toBe(1);
  // The shared chunk is still there, still never deleted.
  expect(after.deletes[stay] ?? 0).toBe(0);
  expect(after.cached).toContain(keyOf(STAY));
  expect(after.cached).not.toContain(keyOf(FAR));
});
