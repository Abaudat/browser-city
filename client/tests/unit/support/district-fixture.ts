// The live city's district as the client sees it: the committed dump
// (`fixtures/district-pinned.v1.json`, written by `regen-district-fixture`
// from the same `District::region_rows` the module inserts) loaded into the
// same indexes the scene feeds: the placed props, the ownership areas, and
// the ground and roof rects the module writes. A row's id is its position
// in its own list (the module's `auto_inc` order).
//
// Specs and tests find what they need in the district with the queries below
// ("the first building whose type is X"), never by a coordinate copied here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  BuildingArea,
  GroundArea,
  PlacedObject,
  RoofArea,
  RoomArea,
} from "../../../src/net/bindings/types";
import { chunkKey } from "../../../src/world/chunk";
import { ChunkStore, type WorldSink } from "../../../src/world/chunk-store";
import { OwnershipIndex } from "../../../src/world/ownership";
import { WorldIndex } from "../../../src/world/world-index";
import { committedDefs, committedMovementConfig, committedObjectSources } from "./committed-defs";

const FIXTURE = fileURLToPath(
  new URL("../../../../fixtures/district-pinned.v1.json", import.meta.url),
);

interface RawDump {
  readonly version: number;
  readonly seed: number;
  readonly site: [number, number, number, number];
  readonly arrival: [number, number];
  /** `[def, x, y, floor, layer, orientation]` */
  readonly objects: [number, number, number, number, number, number][];
  /** `[def, x0, y0, x1, y1, floor]` */
  readonly ground: [number, number, number, number, number, number][];
  /** `[building, def, x0, y0, x1, y1, floor]` */
  readonly roofs: [string, number, number, number, number, number, number][];
  /** `[owner, x0, y0, x1, y1, floor]` */
  readonly buildingAreas: [string, number, number, number, number, number][];
  readonly roomAreas: [string, number, number, number, number, number][];
}

export interface District {
  readonly seed: number;
  readonly site: { x0: number; y0: number; x1: number; y1: number };
  readonly arrival: { x: number; y: number };
  readonly objects: readonly PlacedObject[];
  readonly ground: readonly GroundArea[];
  readonly roofs: readonly RoofArea[];
  readonly buildingAreas: readonly BuildingArea[];
  readonly roomAreas: readonly RoomArea[];
}

const cached = new Map<string, District>();

/** The district as the module holds it. `placedIdOffset` is how many
 * `placed_object` rows were inserted before the district's own (the e2e
 * world restores the fixture block first); the unit tests read it as 0. */
export function loadDistrict(placedIdOffset = 0, groundIdOffset = 0): District {
  const cacheKey = `${placedIdOffset}:${groundIdOffset}`;
  const held = cached.get(cacheKey);
  if (held) return held;
  const raw = JSON.parse(readFileSync(FIXTURE, "utf-8")) as RawDump;
  const objects = raw.objects.map(
    ([defId, x, y, floor, layer, orientation], index): PlacedObject => ({
      objectId: BigInt(index + 1 + placedIdOffset),
      defId,
      x,
      y,
      floor,
      layer,
      orientation,
      chunkKey: chunkKey(x, y, floor),
    }),
  );
  const ground = raw.ground.map(
    ([defId, x0, y0, x1, y1, floor], index): GroundArea => ({
      areaId: BigInt(index + 1 + groundIdOffset),
      defId,
      x0,
      y0,
      x1,
      y1,
      floor,
      chunkKey: chunkKey(x0, y0, floor),
    }),
  );
  // A building's roof rows are all keyed on the chunk of its roof's
  // south-west cell (the westmost x0, the southmost row).
  const roofAnchor = new Map<string, { x: number; y: number }>();
  for (const [buildingId, , x0, , , y1] of raw.roofs) {
    const held = roofAnchor.get(buildingId);
    roofAnchor.set(buildingId, {
      x: Math.min(held?.x ?? x0, x0),
      y: Math.max(held?.y ?? y1 - 1, y1 - 1),
    });
  }
  const roofs = raw.roofs.map(
    ([buildingId, defId, x0, y0, x1, y1, floor], index): RoofArea => ({
      areaId: BigInt(index + 1),
      buildingId: BigInt(buildingId),
      defId,
      x0,
      y0,
      x1,
      y1,
      floor,
      chunkKey: chunkKey(
        roofAnchor.get(buildingId)?.x ?? x0,
        roofAnchor.get(buildingId)?.y ?? y0,
        floor,
      ),
    }),
  );
  const buildingAreas = raw.buildingAreas.map(
    ([buildingId, x0, y0, x1, y1, floor], index): BuildingArea => ({
      areaId: BigInt(index + 1),
      buildingId: BigInt(buildingId),
      x0,
      y0,
      x1,
      y1,
      floor,
      chunkKey: chunkKey(x0, y0, floor),
    }),
  );
  const roomAreas = raw.roomAreas.map(
    ([roomId, x0, y0, x1, y1, floor], index): RoomArea => ({
      areaId: BigInt(index + 1),
      roomId: BigInt(roomId),
      x0,
      y0,
      x1,
      y1,
      floor,
      chunkKey: chunkKey(x0, y0, floor),
    }),
  );
  const district: District = {
    seed: raw.seed,
    site: { x0: raw.site[0], y0: raw.site[1], x1: raw.site[2], y1: raw.site[3] },
    arrival: { x: raw.arrival[0], y: raw.arrival[1] },
    objects,
    ground,
    roofs,
    buildingAreas,
    roomAreas,
  };
  cached.set(cacheKey, district);
  return district;
}

/** The district fed through the same sink the scene attaches: collision and
 * footprint indexes, and ownership. */
export interface DistrictWorld {
  readonly district: District;
  readonly store: ChunkStore;
  readonly world: WorldIndex;
  readonly ownership: OwnershipIndex;
}

const cachedWorlds = new Map<string, DistrictWorld>();

export function districtWorld(placedIdOffset = 0, groundIdOffset = 0): DistrictWorld {
  const cacheKey = `${placedIdOffset}:${groundIdOffset}`;
  const held = cachedWorlds.get(cacheKey);
  if (held) return held;
  const district = loadDistrict(placedIdOffset, groundIdOffset);
  const config = committedMovementConfig();
  const world = new WorldIndex(config.subcellsPerCell, committedObjectSources());
  const ownership = new OwnershipIndex();
  const store = new ChunkStore();
  const sink: WorldSink = {
    placedInserted: (r) => world.insert(r),
    placedDeleted: (r) => world.delete(r),
    buildingAreaInserted: (r) =>
      ownership.insertBuilding(r.areaId, {
        ownerId: r.buildingId,
        floor: r.floor,
        rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
      }),
    buildingAreaDeleted: (r) => ownership.deleteBuilding(r.areaId),
    roomAreaInserted: (r) =>
      ownership.insertRoom(r.areaId, {
        ownerId: r.roomId,
        floor: r.floor,
        rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
      }),
    roomAreaDeleted: (r) => ownership.deleteRoom(r.areaId),
  };
  store.attach(sink);
  for (const r of district.objects) store.insert("placedObject", r);
  for (const r of district.ground) store.insert("groundArea", r);
  for (const r of district.roofs) store.insert("roofArea", r);
  for (const r of district.buildingAreas) store.insert("buildingArea", r);
  for (const r of district.roomAreas) store.insert("roomArea", r);
  const built = { district, store, world, ownership };
  cachedWorlds.set(cacheKey, built);
  return built;
}

export { committedDefs };
