import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDefs } from "../../../src/defs/parse";
import { computeCamera, ZOOM } from "../../../src/render/camera";
import { visibleCellBounds, worldPointPx } from "../../../src/render/screen-position";
import { CHUNK_SIZE, chunkKey } from "../../../src/world/chunk";
import {
  bandFloors,
  bandOf,
  chunkKeysOfHandle,
  columnOf,
  type HandleKey,
  handleId,
  planRegion,
  REGION_BODY_MARGIN_CELLS,
  REGION_LATENCY_BUDGET_MS,
  REGION_LEAVE_RADIUS_CHUNKS,
  REGION_MAX_HANDLES,
  REGION_MAX_VIEWPORT_PX,
  REGION_MIN_VIEWPORT_PX,
  REGION_RADIUS_CHUNKS,
} from "../../../src/world/region";
import { sizeProbe } from "../setup/size-probe";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const defs = parseDefs(
  JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")),
);
const balance = (key: string): number => {
  const e = defs.balance.find((b) => b.key === key);
  if (!e) throw new Error(`no balance ${key}`);
  return e.value;
};
const TILE = balance("render.tile_size_px");
const STOREY = balance("render.storey_height_px");
const WALK = balance("movement.walk_speed_millicells_per_s");
const FLOORS = { minFloor: defs.minFloor, maxFloor: defs.maxFloor };
const I32_MIN = -(2 ** 31);
const I32_MAX = 2 ** 31 - 1;

const clampI32 = (v: number): number => Math.max(I32_MIN, Math.min(I32_MAX, v));
const cell = () =>
  fc.oneof(
    fc.integer({ min: -200, max: 200 }),
    fc.integer({ min: I32_MIN, max: I32_MAX }),
    fc.constantFrom(I32_MIN, I32_MAX, -1, 0, 31, 32, -32, -33),
  );
const floor = () => fc.integer({ min: defs.minFloor, max: defs.maxFloor });
const pos = () => fc.record({ x: cell(), y: cell(), floor: floor() });

const cheb = (a: HandleKey, cx: number, cy: number) =>
  Math.max(Math.abs(a.cx - cx), Math.abs(a.cy - cy));

function applyPlan(held: Map<string, HandleKey>, p: { x: number; y: number; floor: number }) {
  const plan = planRegion([...held.values()], p);
  for (const k of plan.release) held.delete(handleId(k));
  for (const k of plan.subscribe) held.set(handleId(k), k);
  return plan;
}

describe("planRegion", () => {
  // any position requests at most the declared bound
  it("inv_interest_region_is_bounded", () => {
    fc.assert(
      fc.property(pos(), (p) => {
        const plan = planRegion([], p);
        expect(plan.subscribe.length).toBeLessThanOrEqual(REGION_MAX_HANDLES);
        expect(plan.subscribe.length).toBe((2 * REGION_RADIUS_CHUNKS + 1) ** 2);
        expect(plan.release).toEqual([]);
      }),
    );
  });

  // enter(pos) <= held <= keep(pos) over any walk
  // CI worst case under coverage: 1.16 s (run 37229489003); the property's case count is the thing under test, so the work
  // cannot shrink. 60 s is over 10x that.
  const PROPERTY_TIMEOUT_MS = 60_000;
  it("inv_interest_held_set_is_between_enter_and_keep", { timeout: PROPERTY_TIMEOUT_MS }, () => {
    expect(REGION_LEAVE_RADIUS_CHUNKS).toBeGreaterThan(REGION_RADIUS_CHUNKS);
    const step = fc.oneof(
      pos(), // a teleport
      fc.record({
        dx: fc.integer({ min: -40, max: 40 }),
        dy: fc.integer({ min: -40, max: 40 }),
        df: fc.constantFrom(-1, 0, 1),
      }),
    );
    const probe = sizeProbe({ min: 0, max: 40 });
    fc.assert(
      fc.property(
        pos(),
        probe.over(fc.array(step, { maxLength: 40 }), (a) => a.length),
        (start, steps) => {
          const held = new Map<string, HandleKey>();
          let cur = start;
          applyPlan(held, cur);
          for (const s of steps) {
            cur =
              "dx" in s
                ? {
                    x: clampI32(cur.x + s.dx),
                    y: clampI32(cur.y + s.dy),
                    floor: Math.max(defs.minFloor, Math.min(defs.maxFloor, cur.floor + s.df)),
                  }
                : s;
            applyPlan(held, cur);
            const { cx, cy } = columnOf(cur.x, cur.y);
            const band = bandOf(cur.floor);
            for (let dx = -REGION_RADIUS_CHUNKS; dx <= REGION_RADIUS_CHUNKS; dx++) {
              for (let dy = -REGION_RADIUS_CHUNKS; dy <= REGION_RADIUS_CHUNKS; dy++) {
                expect(held.has(handleId({ cx: cx + dx, cy: cy + dy, band }))).toBe(true);
              }
            }
            for (const k of held.values()) {
              expect(cheb(k, cx, cy)).toBeLessThanOrEqual(REGION_LEAVE_RADIUS_CHUNKS);
            }
            expect(held.size).toBeLessThanOrEqual(REGION_MAX_HANDLES);
          }
        },
      ),
    );
    probe.expectReached(30);
  });

  // oscillating across a boundary changes the held set at most once
  it("inv_interest_hysteresis_never_thrashes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -(2 ** 20), max: 2 ** 20 }),
        fc.integer({ min: -(2 ** 20), max: 2 ** 20 }),
        floor(),
        fc.constantFrom<"x" | "y">("x", "y"),
        fc.integer({ min: 1, max: 12 }),
        (bx, by, f, axis, oscillations) => {
          // Two cells either side of one chunk boundary on one axis.
          const edgeX = bx * CHUNK_SIZE;
          const edgeY = by * CHUNK_SIZE;
          const below = {
            x: edgeX - (axis === "x" ? 1 : 0),
            y: edgeY - (axis === "y" ? 1 : 0),
            floor: f,
          };
          const above = { x: edgeX, y: edgeY, floor: f };
          const held = new Map<string, HandleKey>();
          applyPlan(held, below);
          const snapshot = (): string => [...held.keys()].sort().join("|");
          let last = snapshot();
          let changes = 0;
          for (let i = 0; i < oscillations; i++) {
            for (const p of [above, below]) {
              applyPlan(held, p);
              const now = snapshot();
              if (now !== last) changes++;
              last = now;
            }
          }
          // below -> above grows the set once; nothing after changes it.
          expect(changes).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("subscribes the nearest column first", () => {
    const plan = planRegion([], { x: 0, y: 0, floor: 0 });
    const dist = plan.subscribe.map((k) => Math.max(Math.abs(k.cx), Math.abs(k.cy)));
    expect(dist).toEqual([...dist].sort((a, b) => a - b));
    expect(plan.subscribe[0]).toEqual({ cx: 0, cy: 0, band: 0 });
  });

  it("a band change adds the new band and releases the old one only by distance", () => {
    const held = new Map<string, HandleKey>();
    applyPlan(held, { x: 0, y: 0, floor: 0 });
    const plan = applyPlan(held, { x: 0, y: 0, floor: -1 });
    expect(plan.release).toEqual([]);
    expect(plan.subscribe.every((k) => k.band === 1)).toBe(true);
    expect(held.size).toBe(2 * (2 * REGION_RADIUS_CHUNKS + 1) ** 2);
    expect(held.size).toBeLessThanOrEqual(REGION_MAX_HANDLES);
  });
});

describe("bands", () => {
  it("non-negative floors share one band, negative floors the other", () => {
    expect(bandFloors(0, FLOORS)).toEqual(Array.from({ length: defs.maxFloor + 1 }, (_, i) => i));
    expect(bandFloors(1, FLOORS)).toEqual(
      Array.from({ length: -defs.minFloor }, (_, i) => defs.minFloor + i),
    );
    expect(bandOf(0)).toBe(0);
    expect(bandOf(-1)).toBe(1);
  });
});

describe("handle keys", () => {
  // every chunk key is exact as a bigint
  it("a handle's chunk keys are the exact bigint for every floor of its band", () => {
    const chunkCoord = fc.oneof(
      fc.integer({ min: -(2 ** 23), max: 2 ** 23 - 1 }),
      fc.constantFrom(-(2 ** 23), 2 ** 23 - 1, -1, 0, 1),
    );
    fc.assert(
      fc.property(chunkCoord, chunkCoord, fc.constantFrom<0 | 1>(0, 1), (cx, cy, band) => {
        const keys = chunkKeysOfHandle({ cx, cy, band }, FLOORS);
        const floors = bandFloors(band, FLOORS);
        expect(keys.length).toBe(floors.length);
        keys.forEach((k, i) => {
          expect(typeof k).toBe("bigint");
          expect(k).toBe(chunkKey(cx * CHUNK_SIZE, cy * CHUNK_SIZE, floors[i] as number));
        });
      }),
    );
  });
});

describe("the region covers what is on screen", () => {
  it("REGION_RADIUS_CHUNKS * CHUNK_SIZE covers half a viewport, the body margin, the footprint halo and the upper-floor shift", () => {
    const halfW = Math.ceil(REGION_MAX_VIEWPORT_PX.width / ZOOM / TILE / 2);
    const halfH = Math.ceil(REGION_MAX_VIEWPORT_PX.height / ZOOM / TILE / 2);
    const southShift = Math.ceil((defs.maxFloor * STOREY) / TILE);
    const reach = REGION_RADIUS_CHUNKS * CHUNK_SIZE;
    const base = REGION_BODY_MARGIN_CELLS + defs.maxFootprintCells;
    expect(reach).toBeGreaterThanOrEqual(halfW + base);
    expect(reach).toBeGreaterThanOrEqual(halfH + base + southShift);
  });

  // every visible cell plus the margin lies in the held set
  it("inv_interest_region_covers_viewport_with_margin", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100000, max: 100000 }),
        fc.integer({ min: -100000, max: 100000 }),
        fc.integer({ min: 0, max: CHUNK_SIZE - 1 }),
        fc.integer({ min: 0, max: CHUNK_SIZE - 1 }),
        floor(),
        fc.integer({ min: REGION_MIN_VIEWPORT_PX.width, max: REGION_MAX_VIEWPORT_PX.width }),
        fc.integer({ min: REGION_MIN_VIEWPORT_PX.height, max: REGION_MAX_VIEWPORT_PX.height }),
        (cxIn, cyIn, ox, oy, f, w, h) => {
          const x = Math.floor(cxIn / CHUNK_SIZE) * CHUNK_SIZE + ox;
          const y = Math.floor(cyIn / CHUNK_SIZE) * CHUNK_SIZE + oy;
          const held = new Map<string, HandleKey>();
          applyPlan(held, { x, y, floor: f });
          const player = worldPointPx(x + 0.5, y + 1, f, TILE, STOREY, ZOOM, 0);
          const camera = computeCamera(player.x, player.y, w, h, ZOOM);
          const margin = REGION_BODY_MARGIN_CELLS + defs.maxFootprintCells;
          for (const g of bandFloors(bandOf(f), FLOORS)) {
            const b = visibleCellBounds(w, h, camera, g, TILE, STOREY);
            const lo = columnOf(b.cellX0 - margin, b.cellY0 - margin);
            const hi = columnOf(b.cellX1 + margin, b.cellY1 + margin);
            for (let cx = lo.cx; cx <= hi.cx; cx++) {
              for (let cy = lo.cy; cy <= hi.cy; cy++) {
                expect(held.has(handleId({ cx, cy, band: bandOf(f) }))).toBe(true);
              }
            }
          }
        },
      ),
    );
  });

  it("a crossing leaves the viewport edge at least speed x latency budget inside the held region", () => {
    const halfW = Math.ceil(REGION_MAX_VIEWPORT_PX.width / ZOOM / TILE / 2);
    const slackCells = REGION_RADIUS_CHUNKS * CHUNK_SIZE - halfW - defs.maxFootprintCells;
    const walkedCells = (WALK / 1000) * (REGION_LATENCY_BUDGET_MS / 1000);
    expect(REGION_BODY_MARGIN_CELLS).toBeGreaterThanOrEqual(walkedCells);
    expect(slackCells).toBeGreaterThanOrEqual(walkedCells);
  });
});
