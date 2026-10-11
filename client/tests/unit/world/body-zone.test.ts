import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDefs } from "../../../src/defs/parse";
import { ZOOM } from "../../../src/render/camera";
import {
  BODY_ACQUIRE_BUDGET_MS,
  BODY_MAX_FRAME_DELTA_MS,
  type BodyCandidate,
  type BodyZone,
  bodyZoneOf,
  inRect,
  planBodies,
  type Rect,
} from "../../../src/world/body-zone";
import { CHUNK_SIZE } from "../../../src/world/chunk";
import {
  BODY_DESPAWN_HYSTERESIS_CELLS,
  REGION_BODY_MARGIN_CELLS,
  REGION_MAX_VIEWPORT_PX,
  REGION_MIN_VIEWPORT_PX,
  REGION_RADIUS_CHUNKS,
} from "../../../src/world/region";

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
const WALK_CELLS_PER_S = balance("movement.walk_speed_millicells_per_s") / 1000;

const viewport = (cx: number, cy: number, w: number, h: number): Rect => ({
  x0: cx - w / 2,
  y0: cy - h / 2,
  x1: cx + w / 2,
  y1: cy + h / 2,
});
const VIEW: Rect = viewport(0, 0, 40, 23);

function apply(held: Set<string>, plan: ReturnType<typeof planBodies>): void {
  for (const id of plan.despawn) held.delete(id);
  for (const id of plan.spawn) held.add(id);
}

/** A walker walks at the canonical speed toward the viewport from `fromX`
 * (cells east of the viewport's edge), one clamped frame at a time. A body
 * draws once `acquireMs` has passed since the plan spawned it. Returns the
 * first frame it draws while already inside the viewport, if any. */
function popsInView(zone: BodyZone, fromX: number, acquireMs: number): boolean {
  const dtMs = BODY_MAX_FRAME_DELTA_MS;
  const step = (WALK_CELLS_PER_S * dtMs) / 1000;
  const held = new Set<string>();
  let spawnedAtMs: number | undefined;
  let x = VIEW.x1 + fromX;
  for (let t = 0; x > VIEW.x0 - 5; t += dtMs) {
    const plan = planBodies(held, [{ id: "w", x, y: 0 }], zone);
    apply(held, plan);
    if (plan.spawn.length > 0 && spawnedAtMs === undefined) spawnedAtMs = t;
    const drawn = spawnedAtMs !== undefined && t - spawnedAtMs >= acquireMs;
    if (drawn) return inRect(VIEW, x, 0);
    x -= step;
  }
  return false;
}

describe("bodyZoneOf", () => {
  it("spawn is the viewport grown by the margin; despawn adds the hysteresis", () => {
    const z = bodyZoneOf(VIEW);
    expect(z.spawn).toEqual({
      x0: VIEW.x0 - REGION_BODY_MARGIN_CELLS,
      y0: VIEW.y0 - REGION_BODY_MARGIN_CELLS,
      x1: VIEW.x1 + REGION_BODY_MARGIN_CELLS,
      y1: VIEW.y1 + REGION_BODY_MARGIN_CELLS,
    });
    expect(z.despawn.x0).toBe(z.spawn.x0 - BODY_DESPAWN_HYSTERESIS_CELLS);
    expect(z.despawn.y1).toBe(z.spawn.y1 + BODY_DESPAWN_HYSTERESIS_CELLS);
  });
});

describe("planBodies", () => {
  it("inv_far_citizen_has_no_body", () => {
    const far: BodyCandidate[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `far-${i}`,
      x: 10_000 + i,
      y: -10_000 - i,
    }));
    const plan = planBodies(new Set(), far, bodyZoneOf(VIEW));
    expect(plan.spawn).toEqual([]);
    expect(plan.keep).toEqual([]);
    expect(plan.despawn).toEqual([]);
  });

  it("spawns inside the spawn rect and keeps a held body until the despawn rect is left", () => {
    const z = bodyZoneOf(VIEW);
    const justInside = { id: "a", x: z.spawn.x1 - 0.01, y: 0 };
    const between = { id: "a", x: z.spawn.x1 + BODY_DESPAWN_HYSTERESIS_CELLS / 2, y: 0 };
    const beyond = { id: "a", x: z.despawn.x1 + 0.01, y: 0 };
    expect(planBodies(new Set(), [justInside], z).spawn).toEqual(["a"]);
    expect(planBodies(new Set(), [between], z).spawn).toEqual([]);
    expect(planBodies(new Set(["a"]), [between], z).keep).toEqual(["a"]);
    expect(planBodies(new Set(["a"]), [beyond], z).despawn).toEqual(["a"]);
  });

  it("a held body whose citizen left the candidates is despawned", () => {
    expect(planBodies(new Set(["gone"]), [], bodyZoneOf(VIEW)).despawn).toEqual(["gone"]);
  });

  it("inv_body_despawn_never_thrashes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -2, max: 2, noNaN: true }), { maxLength: 300 }),
        (wobble) => {
          // A body sits on the spawn boundary while the player wobbles by
          // less than the hysteresis band either side.
          const held = new Set<string>();
          const body = { id: "b", x: VIEW.x1 + REGION_BODY_MARGIN_CELLS, y: 0 };
          let transitions = 0;
          for (const w of wobble) {
            const z = bodyZoneOf(viewport(w, 0, 40, 23));
            const plan = planBodies(held, [body], z);
            apply(held, plan);
            transitions += plan.spawn.length + plan.despawn.length;
            for (const _ of plan.despawn) expect(inRect(z.despawn, body.x, body.y)).toBe(false);
          }
          // Wobble under the band can never despawn: at most the one spawn.
          expect(transitions).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("inv_bodies_never_leak", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1 << 30 }), (seed) => {
        let s = seed;
        const rnd = () => {
          s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
          return s / 0x1_0000_0000;
        };
        const crowd: BodyCandidate[] = Array.from({ length: 60 }, (_, i) => ({
          id: `c${i}`,
          x: rnd() * 400 - 200,
          y: rnd() * 400 - 200,
        }));
        const held = new Set<string>();
        const slots = new Map<string, number>();
        let px = 0;
        let py = 0;
        for (let step = 0; step < 2000; step++) {
          px += (rnd() - 0.5) * 6;
          py += (rnd() - 0.5) * 6;
          const plan = planBodies(held, crowd, bodyZoneOf(viewport(px, py, 40, 23)));
          for (const id of plan.spawn) slots.set(id, (slots.get(id) ?? 0) + 1);
          for (const id of plan.despawn) slots.set(id, (slots.get(id) ?? 0) - 1);
          apply(held, plan);
          expect(new Set([...plan.keep, ...plan.spawn])).toEqual(held);
          const live = [...slots].filter(([, n]) => n > 0).map(([id]) => id);
          expect(new Set(live)).toEqual(held);
          expect([...slots.values()].every((n) => n === 0 || n === 1)).toBe(true);
        }
      }),
      { numRuns: 5 },
    );
  });
});

describe("a body is ready before it is visible", () => {
  it("inv_body_ready_before_visible", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 12, max: 80, noNaN: true }),
        fc.integer({ min: 0, max: BODY_ACQUIRE_BUDGET_MS }),
        (fromX, acquireMs) => {
          expect(popsInView(bodyZoneOf(VIEW), fromX, acquireMs)).toBe(false);
        },
      ),
    );
  });

  it("negative control: with margin 0 a late acquire pops in view", () => {
    const zero: BodyZone = { spawn: VIEW, despawn: VIEW };
    expect(popsInView(zero, 30, BODY_ACQUIRE_BUDGET_MS)).toBe(true);
  });
});

describe("the body margin is arithmetic", () => {
  it("covers the largest sprite extent, a clamped frame's walk and the acquire budget", () => {
    const extentCells = Math.ceil(
      Math.max(...defs.appearanceLayouts.map((l) => Math.max(l.cellWidth, l.cellHeight))) / TILE,
    );
    const walked = (WALK_CELLS_PER_S * (BODY_MAX_FRAME_DELTA_MS + BODY_ACQUIRE_BUDGET_MS)) / 1000;
    expect(REGION_BODY_MARGIN_CELLS).toBeGreaterThanOrEqual(extentCells + walked);
  });

  it("the despawn rect plus the footprint fits in the held region at both extremes", () => {
    const reach = REGION_RADIUS_CHUNKS * CHUNK_SIZE;
    for (const px of [REGION_MIN_VIEWPORT_PX, REGION_MAX_VIEWPORT_PX]) {
      const halfW = Math.ceil(px.width / ZOOM / TILE / 2);
      const halfH = Math.ceil(px.height / ZOOM / TILE / 2);
      const south = Math.ceil((defs.maxFloor * STOREY) / TILE);
      const out = REGION_BODY_MARGIN_CELLS + BODY_DESPAWN_HYSTERESIS_CELLS + defs.maxFootprintCells;
      expect(reach).toBeGreaterThanOrEqual(halfW + out);
      expect(reach).toBeGreaterThanOrEqual(halfH + out + south);
    }
  });
});
