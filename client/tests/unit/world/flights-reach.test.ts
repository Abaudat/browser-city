// FR182 (story 15.15), FR183 (story 15.21): the flight offset is draw-only --
// it reaches the screen through `worldPointPx` and nowhere else -- and the
// pace scale reaches the walked step through `stepAndTransition` and nowhere
// else. Neither touches the sort key, collision, picking or the codec.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { snapToScreenPx, worldPointPx } from "../../../src/render/screen-position";
import { toSortUnits } from "../../../src/render/sort-units";
import {
  buildCharacterDrawable,
  updateCharacterDrawable,
} from "../../../src/test-street/drawables";
import { STREET_TRANSITIONS, streetPlacedRows } from "../../../src/test-street/fixture";
import { buildFlights, FlightIndex } from "../../../src/world/flights";
import {
  committedDefs,
  streetMovementConfig,
  streetObjectSources,
  streetStandable,
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
  it("only the scene, the walk step and the remote gait read flights; only the walk step scales a step", () => {
    const readers = (pattern: RegExp) =>
      sourceFiles(SRC)
        .filter((file) => pattern.test(readFileSync(file, "utf-8")))
        .map((file) => relative(SRC, file).split(sep).join("/"))
        .sort();
    expect(readers(/from\s+"[^"]*world\/flights"|from\s+"\.\/flights"/)).toEqual([
      "test-street/scene.ts",
      "world/floor-walk.ts",
    ]);
    expect(readers(/\.offsetPx\(/)).toEqual(["test-street/scene.ts"]);
    // The scale reaches the step through `stepAndTransition` alone, and the
    // remote walk frame reads the drawn distance.
    expect(readers(/\.stepScale\(/)).toEqual(["world/floor-walk.ts"]);
    expect(readers(/\.drawnDistance\(/)).toEqual([
      "test-street/remote-players-layer.ts",
      "test-street/scene.ts",
    ]);
  });

  it("inv_stair_offset_never_affects_depth_order: on a flight, the player's key is the walked feet", () => {
    // The drawable update takes a position and a floor and nothing else, so
    // no offset can reach the FR123 key; the guard is that arity, the import
    // scan above and 15.13's mounted render-order assertion on the tread row.
    expect(updateCharacterDrawable.length).toBe(4);
    const defs = committedDefs();
    const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
    const flights = buildFlights(
      STREET_TRANSITIONS,
      streetPlacedRows(),
      streetObjectSources(),
      TILE,
      streetStandable,
    );
    const index = new FlightIndex(flights, streetMovementConfig());
    fc.assert(
      fc.property(
        fc.constantFrom(...flights),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        fc.double({ min: 0.3, max: 0.99, noNaN: true }),
        (flight, t, lateral) => {
          const s = flight.startS + t * (flight.fullS - flight.startS);
          const x =
            flight.dirX !== 0 ? s * flight.dirX : flight.x0 + lateral * (flight.x1 - flight.x0);
          const y =
            flight.dirY !== 0 ? s * flight.dirY : flight.y0 + lateral * (flight.y1 - flight.y0);
          expect(index.offsetPx(x, y, flight.floor)).not.toBe(0);
          const player = buildCharacterDrawable(0, x, y, flight.floor);
          updateCharacterDrawable(player, x, y, flight.floor);
          expect(player.x).toBe(toSortUnits(x));
          expect(player.y).toBe(toSortUnits(y));
        },
      ),
    );
  });

  it("drawn feet minus projected logical feet is the stair offset, and zero elsewhere", () => {
    const defs = committedDefs();
    const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0;
    const index = new FlightIndex(
      buildFlights(
        STREET_TRANSITIONS,
        streetPlacedRows(),
        streetObjectSources(),
        TILE,
        streetStandable,
      ),
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
