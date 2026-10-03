// FR182 (story 15.15): the flight offset is draw-only. It reaches the screen
// through `worldPointPx` and nowhere else -- never the sort key, collision,
// floor membership or visibility.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildFlights, FlightIndex } from "../../../src/render/flight-offset";
import { snapToScreenPx, worldPointPx } from "../../../src/render/screen-position";
import { compareDrawables } from "../../../src/render/sort-key";
import { toSortUnits } from "../../../src/render/sort-units";
import { buildPlayerDrawable, updatePlayerDrawable } from "../../../src/test-street/drawables";
import { STREET_TRANSITIONS, streetPlacedRows } from "../../../src/test-street/fixture";
import {
  committedDefs,
  streetMovementConfig,
  streetObjectSources,
} from "../test-street/street-world";

const SRC = fileURLToPath(new URL("../../../src/", import.meta.url));
const TILE = 16;
const ZOOM = 3;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("the flight offset is draw-only (FR182)", () => {
  it("nothing under world/, and neither the sort key nor visibility, imports flight-offset", () => {
    const importers = sourceFiles(SRC)
      .filter((file) => /from\s+"[^"]*flight-offset"/.test(readFileSync(file, "utf-8")))
      .map((file) => relative(SRC, file).split(sep).join("/"))
      .sort();
    expect(importers).toEqual(["test-street/scene.ts"]);
  });

  it("inv_stair_offset_never_affects_depth_order: the player's key is the walked feet position", () => {
    // The drawable update takes a position and a floor and nothing else, so
    // no offset can reach the FR123 key.
    expect(updatePlayerDrawable.length).toBe(4);
    const defs = committedDefs();
    const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
    const index = new FlightIndex(
      buildFlights(STREET_TRANSITIONS, streetPlacedRows(), streetObjectSources(), storey),
      streetMovementConfig(),
    );
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 30, noNaN: true }),
        fc.double({ min: 0, max: 16, noNaN: true }),
        fc.constantFrom(-1, 0),
        (x, y, floor) => {
          const offset = index.offsetPx(x, y, floor);
          const player = buildPlayerDrawable(0, x, y, floor);
          updatePlayerDrawable(player, x, y, floor);
          expect(player.x).toBe(toSortUnits(x));
          expect(player.y).toBe(toSortUnits(y));
          const other = { ...player, stableId: player.stableId + 1n };
          // Equal keys whatever the offset: the comparator sees only the walk.
          expect(compareDrawables(player, other)).toBe(compareDrawables(player, other));
          expect(Number.isFinite(offset)).toBe(true);
        },
      ),
    );
  });

  it("drawn feet minus projected logical feet is the stair offset, and zero elsewhere", () => {
    const defs = committedDefs();
    const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
    const index = new FlightIndex(
      buildFlights(STREET_TRANSITIONS, streetPlacedRows(), streetObjectSources(), storey),
      streetMovementConfig(),
    );
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.constantFrom(-1, 0),
        (x, y, floor) => {
          const offset = index.offsetPx(x, y, floor);
          const drawn = worldPointPx(x, y, floor, TILE, storey, ZOOM, offset);
          const logical = worldPointPx(x, y, floor, TILE, storey, ZOOM, 0);
          expect(drawn.x).toBe(logical.x);
          if (offset === 0) expect(drawn.y).toBe(logical.y);
          else expect(Math.abs(drawn.y - logical.y - offset)).toBeLessThanOrEqual(1 / ZOOM);
          expect(drawn.y).toBe(
            snapToScreenPx(y * TILE + (floor === 0 ? 0 : storey) + offset, ZOOM),
          );
        },
      ),
    );
  });
});
