import { describe, expect, it } from "vitest";
import type { BuildingArea, PlacedObject, RoomArea } from "../../../src/net/bindings/types";
import { chunkKey } from "../../../src/world/chunk";
import { ChunkStore, type WorldSink } from "../../../src/world/chunk-store";

function placed(id: bigint, x: number, y: number, floor = 0): PlacedObject {
  return {
    objectId: id,
    defId: 6,
    x,
    y,
    floor,
    layer: 4,
    orientation: 0,
    chunkKey: chunkKey(x, y, floor),
  };
}
function building(id: bigint, x0: number, y0: number, x1: number, y1: number): BuildingArea {
  return {
    areaId: id,
    buildingId: 100n + id,
    x0,
    y0,
    x1,
    y1,
    floor: 0,
    chunkKey: chunkKey(x0, y0, 0),
  };
}
function room(id: bigint, x0: number, y0: number, x1: number, y1: number): RoomArea {
  return { areaId: id, roomId: 200n + id, x0, y0, x1, y1, floor: 0, chunkKey: chunkKey(x0, y0, 0) };
}

function recorder(): { sink: WorldSink; log: string[] } {
  const log: string[] = [];
  return {
    log,
    sink: {
      placedInserted: (r) => log.push(`+p${r.objectId}`),
      placedDeleted: (r) => log.push(`-p${r.objectId}`),
      buildingAreaInserted: (r) => log.push(`+b${r.areaId}`),
      buildingAreaDeleted: (r) => log.push(`-b${r.areaId}`),
      roomAreaInserted: (r) => log.push(`+r${r.areaId}`),
      roomAreaDeleted: (r) => log.push(`-r${r.areaId}`),
    },
  };
}

describe("ChunkStore (story 3.16)", () => {
  it("holds rows by chunk and forwards every change to an attached sink", () => {
    const store = new ChunkStore();
    const { sink, log } = recorder();
    store.attach(sink);
    store.insert("placedObject", placed(1n, 3, 3));
    store.insert("placedObject", placed(2n, 40, 3));
    store.insert("buildingArea", building(1n, 0, 0, 6, 6));
    store.insert("roomArea", room(1n, 1, 1, 5, 5));
    expect(log).toEqual(["+p1", "+p2", "+b1", "+r1"]);
    expect([...store.chunk(chunkKey(3, 3, 0))!.placed.keys()]).toEqual([1n]);
    expect([...store.chunk(chunkKey(40, 3, 0))!.placed.keys()]).toEqual([2n]);
    store.delete("placedObject", placed(1n, 3, 3));
    expect(log.at(-1)).toBe("-p1");
    expect(store.chunk(chunkKey(3, 3, 0))?.placed.size ?? 0).toBe(0);
  });

  it("replays what it already holds to a sink attached later", () => {
    const store = new ChunkStore();
    store.insert("placedObject", placed(1n, 3, 3));
    store.insert("buildingArea", building(1n, 0, 0, 6, 6));
    const { sink, log } = recorder();
    store.attach(sink);
    expect(log.sort()).toEqual(["+b1", "+p1"]);
  });

  it("treats an insert of a held row id as a replacement, never a duplicate", () => {
    const store = new ChunkStore();
    const { sink, log } = recorder();
    store.attach(sink);
    store.insert("placedObject", placed(1n, 3, 3));
    store.insert("placedObject", placed(1n, 3, 3));
    expect(log).toEqual(["+p1", "-p1", "+p1"]);
    expect(store.chunk(chunkKey(3, 3, 0))!.placed.size).toBe(1);
  });

  it("reports an update as a delete of the old row and an insert of the new", () => {
    const store = new ChunkStore();
    const { sink, log } = recorder();
    store.attach(sink);
    store.insert("placedObject", placed(1n, 3, 3));
    store.update("placedObject", placed(1n, 3, 3), placed(1n, 4, 3));
    expect(log).toEqual(["+p1", "-p1", "+p1"]);
  });

  it("ignores a table the world does not draw", () => {
    const store = new ChunkStore();
    expect(() => store.insert("playerPosition", { characterId: 1n })).not.toThrow();
    expect(store.chunkKeys()).toHaveLength(0);
  });

  it("marks a chunk applied only when its handle applies", () => {
    const store = new ChunkStore();
    const k = chunkKey(3, 3, 0);
    store.insert("placedObject", placed(1n, 3, 3));
    expect(store.isApplied(k)).toBe(false);
    store.markApplied([k]);
    expect(store.isApplied(k)).toBe(true);
    store.markReleased([k]);
    expect(store.isApplied(k)).toBe(false);
  });
});
