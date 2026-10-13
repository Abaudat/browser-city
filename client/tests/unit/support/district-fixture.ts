// The live city's district as the client sees it: the committed dump
// (`fixtures/district-pinned.v1.json`, written by `regen-district-fixture`
// from the same `District::region_rows` the module inserts) loaded into the
// same indexes the scene feeds. Ground rows are not in the dump -- they are
// derived from `city.ground.*` and would only repeat the site.
//
// Specs and tests find what they need in the district with the queries below
// ("the first building whose type is X"), never by a coordinate copied here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BuildingArea, PlacedObject, RoomArea } from "../../../src/net/bindings/types";
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
  readonly groundObjectIds: [number, number, number, number];
  readonly groundMargin: number;
  readonly objects: [number, number, number, number, number, number, number][];
  readonly buildingAreas: [number, number, number, number, number, number, number][];
  readonly roomAreas: [number, number, number, number, number, number, number][];
}

export interface District {
  readonly seed: number;
  readonly site: { x0: number; y0: number; x1: number; y1: number };
  readonly arrival: { x: number; y: number };
  readonly objects: readonly PlacedObject[];
  readonly buildingAreas: readonly BuildingArea[];
  readonly roomAreas: readonly RoomArea[];
}

let cached: District | undefined;

export function loadDistrict(): District {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(FIXTURE, "utf-8")) as RawDump;
  const objects = raw.objects.map(
    ([id, defId, x, y, floor, layer, orientation]): PlacedObject => ({
      objectId: BigInt(id),
      defId,
      x,
      y,
      floor,
      layer,
      orientation,
      chunkKey: chunkKey(x, y, floor),
    }),
  );
  const buildingAreas = raw.buildingAreas.map(
    ([id, buildingId, x0, y0, x1, y1, floor]): BuildingArea => ({
      areaId: BigInt(id),
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
    ([id, roomId, x0, y0, x1, y1, floor]): RoomArea => ({
      areaId: BigInt(id),
      roomId: BigInt(roomId),
      x0,
      y0,
      x1,
      y1,
      floor,
      chunkKey: chunkKey(x0, y0, floor),
    }),
  );
  cached = {
    seed: raw.seed,
    site: { x0: raw.site[0], y0: raw.site[1], x1: raw.site[2], y1: raw.site[3] },
    arrival: { x: raw.arrival[0], y: raw.arrival[1] },
    objects,
    buildingAreas,
    roomAreas,
  };
  return cached;
}

/** The district fed through the same sink the scene attaches: collision and
 * footprint indexes, and ownership. */
export interface DistrictWorld {
  readonly district: District;
  readonly store: ChunkStore;
  readonly world: WorldIndex;
  readonly ownership: OwnershipIndex;
}

let cachedWorld: DistrictWorld | undefined;

export function districtWorld(): DistrictWorld {
  if (cachedWorld) return cachedWorld;
  const district = loadDistrict();
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
  for (const r of district.buildingAreas) store.insert("buildingArea", r);
  for (const r of district.roomAreas) store.insert("roomArea", r);
  cachedWorld = { district, store, world, ownership };
  return cachedWorld;
}

export { committedDefs };
