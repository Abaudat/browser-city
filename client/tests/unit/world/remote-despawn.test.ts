// Story 4.9 (FR139): the region's hold, seen from a remote player's column and
// band: held inside the keep radius, not held beyond it, and never thrashing
// at a boundary. That the sprite goes away through the handle release is the
// e2e's (`player-position.spec.ts`); there is no timer.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { REMOTE_STABLE_ID_BASE } from "../../../src/test-street/drawables";
import { STREET_PROPS } from "../../../src/test-street/fixture";
import { CHUNK_SIZE } from "../../../src/world/chunk";
import {
  bandOf,
  columnOf,
  type HandleKey,
  handleId,
  planRegion,
  REGION_LEAVE_RADIUS_CHUNKS,
} from "../../../src/world/region";

type Pos = { x: number; y: number; floor: number };

/** Whether the viewer's held handles include the column and band of `p`. */
function remoteHeld(held: Map<string, HandleKey>, p: Pos): boolean {
  const { cx, cy } = columnOf(p.x, p.y);
  return held.has(handleId({ cx, cy, band: bandOf(p.floor) }));
}

function applyPlan(held: Map<string, HandleKey>, centre: Pos): void {
  const plan = planRegion([...held.values()], centre);
  for (const k of plan.release) held.delete(handleId(k));
  for (const k of plan.subscribe) held.set(handleId(k), k);
}

const cheb = (a: Pos, b: Pos): number => {
  const ca = columnOf(a.x, a.y);
  const cb = columnOf(b.x, b.y);
  return Math.max(Math.abs(ca.cx - cb.cx), Math.abs(ca.cy - cb.cy));
};

describe("a remote player is despawned only outside the keep region (FR139)", () => {
  const near = fc.record({
    x: fc.integer({ min: -10 * CHUNK_SIZE, max: 10 * CHUNK_SIZE }),
    y: fc.integer({ min: -10 * CHUNK_SIZE, max: 10 * CHUNK_SIZE }),
    floor: fc.constantFrom(-1, 0, 1),
  });

  it("inv_remote_player_despawns_only_outside_keep_region", () => {
    fc.assert(
      fc.property(near, fc.array(near, { maxLength: 40 }), near, (start, viewerWalk, remote) => {
        const held = new Map<string, HandleKey>();
        applyPlan(held, start);
        let wasHeld = remoteHeld(held, remote);
        for (const viewer of viewerWalk) {
          applyPlan(held, viewer);
          const nowHeld = remoteHeld(held, remote);
          const sameBand = bandOf(viewer.floor) === bandOf(remote.floor);
          // Inside the keep rect (same band, within the leave radius) a held
          // remote is never removed.
          if (wasHeld && sameBand && cheb(viewer, remote) <= REGION_LEAVE_RADIUS_CHUNKS) {
            expect(nowHeld).toBe(true);
          }
          // A remote beyond the keep rect, or in the other band, is not held
          // when the viewer is in the band that excludes it.
          if (sameBand && cheb(viewer, remote) > REGION_LEAVE_RADIUS_CHUNKS) {
            expect(nowHeld).toBe(false);
          }
          wasHeld = nowHeld;
        }
      }),
      { numRuns: 300 },
    );
  });

  it("a walk oscillating across the boundary removes and re-adds the remote at most once", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -(2 ** 12), max: 2 ** 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        (bx, oscillations, gap) => {
          // The remote stands REGION_LEAVE_RADIUS_CHUNKS + 1 columns east of
          // `bx`; the viewer steps one cell either side of the chunk edge that
          // puts it inside and outside the keep radius.
          const remote: Pos = {
            x: (bx + REGION_LEAVE_RADIUS_CHUNKS + 1) * CHUNK_SIZE + gap,
            y: 0,
            floor: 0,
          };
          const inside: Pos = { x: (bx + 1) * CHUNK_SIZE, y: 0, floor: 0 };
          const outside: Pos = { x: (bx + 1) * CHUNK_SIZE - 1, y: 0, floor: 0 };
          const held = new Map<string, HandleKey>();
          applyPlan(held, outside);
          let last = remoteHeld(held, remote);
          let changes = 0;
          for (let i = 0; i < oscillations; i++) {
            for (const p of [inside, outside]) {
              applyPlan(held, p);
              const now = remoteHeld(held, remote);
              if (now !== last) changes++;
              last = now;
            }
          }
          expect(changes).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe("a remote player's sort tie-breaker id", () => {
  it("is in a reserved range above every placed object's id", () => {
    for (const prop of STREET_PROPS) expect(prop.id).toBeLessThan(REMOTE_STABLE_ID_BASE);
  });
});
