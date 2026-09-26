// Regenerates `golden.ts` from the real comparator and the real
// `computeVisibility`, so no expected order or visibility map is ever
// hand-typed (Quentin's direction, story 1.13). Run by hand after the
// street's own data changes:
//
//     cd client && npx vite-node tests/unit/test-street/regen-golden.ts
//
// This is a generator, never a test: `drawables.test.ts` is what holds
// the committed output to the real functions, and `render-order.spec.ts`/
// `test-street.spec.ts` are what hold the real mounted adapter to the
// same file.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sortAcrossFloors } from "../../../src/render/floor-stacks";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { FIRST_POOL_RANK, LAYER_TABLE, layerCodeByName } from "../../../src/render/layer-table";
import { computeVisibility, type VisibilityViewer } from "../../../src/render/visibility";
import { buildPlayerDrawable, buildPropDrawables } from "../../../src/test-street/drawables";
import {
  LAMPPOST_CELL,
  PLATFORM_LANDING_X,
  PLATFORM_LANDING_Y,
  PLAYER_START,
  STREET_GROUND_TILES,
  SUBWAY_FLOOR,
} from "../../../src/test-street/fixture";
import { cellOf, NO_OWNER } from "../../../src/world/ownership";
import {
  lamppostRestY,
  streetObjectSources,
  streetOwnershipIndex,
  streetWindowDefIds,
} from "./street-world";

const CODE_BY_NAME: Record<string, number> = Object.fromEntries(
  LAYER_TABLE.map((row) => [row.name, row.code]),
);
const RANK_TABLE = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));

function rankOf(layer: string): number {
  const code = CODE_BY_NAME[layer];
  if (code === undefined) throw new Error(`unknown street layer ${layer}`);
  return resolveRank(RANK_TABLE, code);
}

const ownership = streetOwnershipIndex();
const props = () =>
  buildPropDrawables({
    rankOf,
    ownership,
    windowDefIds: streetWindowDefIds(),
    objectDefs: streetObjectSources(),
  });

function orderAt(x: number, y: number, floor: number): string[] {
  const player = buildPlayerDrawable(rankOf("characters"), x, y, floor);
  // Flat-pass drawables are never pool members: `window.__bc.renderOrder`
  // (and so this golden) lists the pool only.
  return sortAcrossFloors([...props(), player], (d) => d)
    .filter((d) => d.rank >= FIRST_POOL_RANK)
    .map((d) => d.stableId.toString());
}

const GROUND_FLOORS = [...new Set(STREET_GROUND_TILES.map((tiles) => tiles.floor))].sort(
  (a, b) => a - b,
);

function visibilityAt(x: number, y: number, floor: number): Record<string, string> {
  const player = buildPlayerDrawable(rankOf("characters"), x, y, floor);
  const viewer: VisibilityViewer = {
    floor,
    buildingId: ownership.ownershipAt(cellOf(x), cellOf(y), floor).buildingId,
  };
  const result: Record<string, string> = {};
  const flatFloors = new Set<number>();
  for (const drawable of [...props(), player]) {
    if (drawable.rank < FIRST_POOL_RANK) {
      flatFloors.add(drawable.floor);
      continue;
    }
    result[drawable.stableId.toString()] = computeVisibility(viewer, drawable);
  }
  const group = (floor: number, layer: string) =>
    computeVisibility(viewer, {
      floor,
      layerCode: layerCodeByName(layer),
      ownerBuildingId: NO_OWNER,
      isWindow: false,
      isNearSide: false,
      isStub: false,
    });
  for (const groundFloor of GROUND_FLOORS) {
    result[`ground:${groundFloor}`] = group(groundFloor, "ground");
  }
  for (const floor of flatFloors) {
    result[`ground_objects:${floor}`] = group(floor, "ground_objects");
  }
  return result;
}

function orderLiteral(name: string, order: readonly string[]): string {
  return `export const ${name}: readonly string[] = [\n${order
    .map((id) => `  "${id}",`)
    .join("\n")}\n];\n`;
}

function mapLiteral(name: string, map: Readonly<Record<string, string>>): string {
  const entries = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `  "${key}": "${value}",`)
    .join("\n");
  return `export const ${name}: Readonly<Record<string, string>> = {\n${entries}\n};\n`;
}

const header = `// The street scene's committed depth order and visibility states
// (Quentin's direction): shared verbatim by \`drawables.test.ts\` (which
// runs the real comparator and the real \`computeVisibility\` directly, in
// vitest's node environment) and by the e2e specs (which read the same
// values back out of a real mounted Pixi display list through
// \`window.__bc\`) -- so the pure functions and the real adapter can never
// silently disagree about what this scene renders.
//
// GENERATED, never hand-edited: \`npx vite-node
// tests/unit/test-street/regen-golden.ts\` rewrites this file from those
// same real functions. Decimal strings, matching \`window.__bc.renderOrder\`
// (\`bigint\` does not survive Playwright's page-to-Node serialisation).
//
// The order is grouped by floor, ascending, and ordered within a floor by
// the FR123 comparator alone (\`render/floor-stacks.ts\`'s
// \`sortAcrossFloors\`) -- exactly the order a mounted scene produces, one
// pool per floor drawn in ascending floor order. Ids at \`500000\` and above
// are the FR120 wall-stub companions (\`test-street/drawables.ts\`'s
// \`STUB_ID_OFFSET\`); \`ground:<floor>\` keys are the flat ground passes
// (FR122 culls those as completely as it culls pool sprites);
// \`ground_objects:<floor>\` keys are the flat ground-object passes, whose
// members are not in the order at all.
`;

const out = [
  header,
  orderLiteral("STREET_GOLDEN_ORDER", orderAt(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor)),
  orderLiteral(
    "STREET_GOLDEN_ORDER_AFTER_WALKING_SOUTH",
    // Story 2.13: `LAMPPOST_CELL.x`, not `PLAYER_START.x` -- the lamppost
    // no longer shares the door's own column (`LAMPPOST_CELL`'s own doc
    // comment says why), so the rest position this golden pins is the
    // lamppost's own cell centre, matching where the scripted walk's own
    // "part-way-through-the-lamppost" checkpoint actually lands.
    orderAt(LAMPPOST_CELL.x + 0.5, lamppostRestY(), PLAYER_START.floor),
  ),
  mapLiteral(
    "STREET_VISIBILITY_AT_REST_IN_SHOP_A",
    visibilityAt(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor),
  ),
  mapLiteral(
    "STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE",
    visibilityAt(LAMPPOST_CELL.x + 0.5, lamppostRestY(), PLAYER_START.floor),
  ),
  mapLiteral(
    "STREET_VISIBILITY_ON_SUBWAY_LANDING",
    visibilityAt(PLATFORM_LANDING_X + 0.5, PLATFORM_LANDING_Y + 0.5, SUBWAY_FLOOR),
  ),
].join("\n");

const target = fileURLToPath(new URL("./golden.ts", import.meta.url));
writeFileSync(target, out, "utf-8");
console.log(`regen-golden: wrote ${target}`);
