// Story 3.16 AC2: at least 100 buildings are enterable, furnished and
// wall-retracted on entry. Measured over every building of the committed
// district's streamed rows -- never a sample:
//   - enterable: a body fits on a floor cell of one of its rooms and that
//     cell is reached on foot from the arrival cell, over the real grid;
//   - retracted: with the viewer on that cell, every near-side wall the
//     building owns is hidden by `computeVisibility`, no other building's
//     wall is, and stepping back out restores them (FR120, keyed on
//     ownership, never proximity).
// Furnished is counted in the module's own tests (`district_world.rs`, room
// programs from defs); here a building must hold furniture beyond its shell.

import { describe, expect, it } from "vitest";
import type { PlacedObject } from "../../../src/net/bindings/types";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { LAYER_TABLE, layerCodeByName } from "../../../src/render/layer-table";
import { buildPropDrawables } from "../../../src/render/prop-drawables";
import { computeVisibility } from "../../../src/render/visibility";
import { objectDefsById } from "../../../src/world/object-defs";
import { NO_OWNER } from "../../../src/world/ownership";
import { isBodyClear } from "../../../src/world/standable";
import {
  committedDefs,
  committedMovementConfig,
  committedThresholdDefIds,
  committedWindowDefIds,
} from "../support/committed-defs";
import { districtWorld } from "../support/district-fixture";

const { district, world, ownership } = districtWorld();
const config = committedMovementConfig();
const sub = config.subcellsPerCell;
const defs = committedDefs();
const WALLS = layerCodeByName("walls");
const GROUND = layerCodeByName("ground");
const rank = buildLayerRankTable(LAYER_TABLE.map(({ code, rank: r }) => ({ code, rank: r })));
const wallStub = defs.balance.find((b) => b.key === "render.wall_stub_object_id")?.value ?? 0;

const W = district.site.x1 - district.site.x0;
const H = district.site.y1 - district.site.y0;
const fits = (x: number, y: number): boolean =>
  x >= district.site.x0 &&
  y >= district.site.y0 &&
  x < district.site.x1 &&
  y < district.site.y1 &&
  isBodyClear(world, config, 0, Math.round((x + 0.5) * sub), Math.round((y + 0.5) * sub));

/** Every cell reachable on foot from the arrival cell. */
function reachableFromArrival(): Uint8Array {
  const seen = new Uint8Array(W * H);
  const at = (x: number, y: number) => y * W + x;
  const queue: number[] = [district.arrival.x, district.arrival.y];
  seen[at(district.arrival.x, district.arrival.y)] = 1;
  for (let head = 0; head < queue.length; head += 2) {
    const x = queue[head] as number;
    const y = queue[head + 1] as number;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[at(nx, ny)] || !fits(nx, ny)) continue;
      seen[at(nx, ny)] = 1;
      queue.push(nx, ny);
    }
  }
  return seen;
}

interface Building {
  readonly id: bigint;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** A floor cell inside one of its rooms where a body fits and which is
   * reached on foot from the arrival. */
  cell?: { x: number; y: number };
  /** Rows the building owns (walls, doors, windows, fixtures). */
  readonly rows: PlacedObject[];
}

function buildings(): Building[] {
  const byId = new Map<bigint, Building>();
  for (const a of district.buildingAreas) {
    const b = byId.get(a.buildingId);
    if (!b) {
      byId.set(a.buildingId, {
        id: a.buildingId,
        x0: a.x0,
        y0: a.y0,
        x1: a.x1,
        y1: a.y1,
        rows: [],
      });
    } else {
      b.x0 = Math.min(b.x0, a.x0);
      b.y0 = Math.min(b.y0, a.y0);
      b.x1 = Math.max(b.x1, a.x1);
      b.y1 = Math.max(b.y1, a.y1);
    }
  }
  const reach = reachableFromArrival();
  for (const r of district.objects) {
    const owner = ownership.ownershipAt(r.x, r.y, r.floor).buildingId;
    if (owner !== NO_OWNER) byId.get(owner)?.rows.push(r);
  }
  for (const room of district.roomAreas) {
    const owner = ownership.ownershipAt(room.x0, room.y0, room.floor).buildingId;
    const b = byId.get(owner);
    if (!b || b.cell) continue;
    for (let y = room.y0; y < room.y1 && !b.cell; y++) {
      for (let x = room.x0; x < room.x1; x++) {
        if (reach[y * W + x] && fits(x, y) && ownership.ownershipAt(x, y, 0).buildingId === b.id) {
          b.cell = { x, y };
          break;
        }
      }
    }
  }
  return [...byId.values()];
}

const all = buildings();
const enterable = all.filter((b) => b.cell);
const options = {
  rankOf: (code: number) => resolveRank(rank, code),
  ownership,
  windowDefIds: committedWindowDefIds(),
  thresholdDefIds: committedThresholdDefIds(),
  wallStubDefId: wallStub,
  objectDefs: objectDefsById(defs),
};

describe("every enterable building of the district (AC2)", () => {
  it("is at least a hundred, counted over the streamed rows", () => {
    console.log(`district: ${all.length} buildings, ${enterable.length} enterable on foot`);
    expect(enterable.length).toBeGreaterThanOrEqual(100);
  });

  it("is furnished: most buildings hold furniture beyond their shell", () => {
    const hollow = enterable.filter(
      (b) => !b.rows.some((r) => r.layer !== WALLS && r.layer !== GROUND),
    );
    expect(hollow.length).toBeLessThan(enterable.length / 4);
  });

  it("retracts its own front walls on entry, and no other building's, and restores them on leaving", () => {
    let checked = 0;
    let neighbours = 0;
    for (const b of enterable) {
      const cell = b.cell as { x: number; y: number };
      const drawables = buildPropDrawables(
        b.rows.filter((r) => r.layer === WALLS),
        options,
      );
      const walls = drawables.filter((d) => d.layerCode === WALLS && !d.isStub);
      const near = walls.filter((d) => d.isNearSide && d.ownerBuildingId === b.id);
      expect(near.length, `building ${b.id} has a front wall run`).toBeGreaterThan(0);
      const inside = { floor: 0, buildingId: ownership.ownershipAt(cell.x, cell.y, 0).buildingId };
      expect(inside.buildingId).toBe(b.id);
      for (const d of near) {
        expect(computeVisibility(inside, d), `building ${b.id} front wall`).toBe("hidden");
      }
      // Its side and back walls stay drawn.
      for (const d of walls.filter((w) => !w.isNearSide)) {
        expect(computeVisibility(inside, d)).not.toBe("hidden");
      }
      // Stepping out restores the front.
      const out = { floor: 0, buildingId: NO_OWNER };
      for (const d of near) {
        expect(computeVisibility(out, d)).not.toBe("hidden");
      }
      // A neighbouring building's front is never retracted by standing here.
      const other = enterable.find(
        (o) => o.id !== b.id && Math.abs(o.x0 - b.x0) <= 24 && Math.abs(o.y0 - b.y0) <= 24,
      );
      if (other) {
        neighbours++;
        const theirs = buildPropDrawables(
          other.rows.filter((r) => r.layer === WALLS),
          options,
        ).filter((d) => d.layerCode === WALLS && d.isNearSide && d.ownerBuildingId === other.id);
        for (const d of theirs) expect(computeVisibility(inside, d)).not.toBe("hidden");
      }
      checked++;
    }
    expect(checked).toBe(enterable.length);
    expect(neighbours).toBeGreaterThan(50);
  });
});
