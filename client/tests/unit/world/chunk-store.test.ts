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
    expect([...(store.chunk(chunkKey(3, 3, 0))?.placed.keys() ?? [])]).toEqual([1n]);
    expect([...(store.chunk(chunkKey(40, 3, 0))?.placed.keys() ?? [])]).toEqual([2n]);
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
    expect(store.chunk(chunkKey(3, 3, 0))?.placed.size).toBe(1);
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

describe("ChunkStore: the other tables and the edges", () => {
  const roomRow = (id: bigint, x0: number): RoomArea => ({
    areaId: id,
    roomId: 5n,
    x0,
    y0: 0,
    x1: x0 + 2,
    y1: 2,
    floor: 0,
    chunkKey: chunkKey(x0, 0, 0),
  });
  const transition = (id: bigint) => ({
    transitionId: id,
    x: 3,
    y: 3,
    floor: 0,
    targetX: 4,
    targetY: 3,
    targetFloor: -1,
    chunkKey: chunkKey(3, 3, 0),
  });

  it("replaces and removes room areas and building areas by row id", () => {
    const store = new ChunkStore();
    const log: string[] = [];
    store.attach({
      placedInserted: () => {},
      placedDeleted: () => {},
      buildingAreaInserted: (r) => log.push(`+b${r.areaId}`),
      buildingAreaDeleted: (r) => log.push(`-b${r.areaId}`),
      roomAreaInserted: (r) => log.push(`+r${r.areaId}`),
      roomAreaDeleted: (r) => log.push(`-r${r.areaId}`),
    });
    store.insert("roomArea", roomRow(1n, 0));
    store.insert("roomArea", roomRow(1n, 0));
    store.delete("roomArea", roomRow(1n, 0));
    store.delete("roomArea", roomRow(1n, 0));
    store.insert("buildingArea", building(2n, 0, 0, 4, 4));
    store.insert("buildingArea", building(2n, 0, 0, 4, 4));
    store.delete("buildingArea", building(2n, 0, 0, 4, 4));
    expect(log).toEqual(["+r1", "-r1", "+r1", "-r1", "+b2", "-b2", "+b2", "-b2"]);
    expect(store.chunkKeys()).toHaveLength(0);
  });

  it("holds floor transitions and forwards them to a sink that wants them", () => {
    const store = new ChunkStore();
    const log: string[] = [];
    store.attach({
      placedInserted: () => {},
      placedDeleted: () => {},
      buildingAreaInserted: () => {},
      buildingAreaDeleted: () => {},
      roomAreaInserted: () => {},
      roomAreaDeleted: () => {},
      transitionInserted: (r) => log.push(`+t${r.transitionId}`),
      transitionDeleted: (r) => log.push(`-t${r.transitionId}`),
    });
    store.insert("floorTransition", transition(1n));
    store.insert("floorTransition", transition(1n));
    store.delete("floorTransition", transition(1n));
    expect(log).toEqual(["+t1", "-t1", "+t1", "-t1"]);
  });

  it("replays transitions and tolerates a sink with no transition handlers", () => {
    const store = new ChunkStore();
    store.insert("floorTransition", transition(2n));
    store.insert("roomArea", roomRow(3n, 0));
    const log: string[] = [];
    store.attach({
      placedInserted: () => {},
      placedDeleted: () => {},
      buildingAreaInserted: () => {},
      buildingAreaDeleted: () => {},
      roomAreaInserted: (r) => log.push(`+r${r.areaId}`),
      roomAreaDeleted: () => {},
    });
    store.delete("floorTransition", transition(2n));
    expect(log).toEqual(["+r3"]);
  });

  it("tells a listener which chunks changed, and which handle applied", () => {
    const store = new ChunkStore();
    const seen: bigint[] = [];
    store.onChunkChanged((k) => seen.push(k));
    store.insert("placedObject", placed(1n, 3, 3));
    store.markApplied([chunkKey(3, 3, 0), chunkKey(3, 3, -1)]);
    expect(seen).toEqual([chunkKey(3, 3, 0), chunkKey(3, 3, 0), chunkKey(3, 3, -1)]);
  });

  it("ignores the delete of a row it never held", () => {
    const store = new ChunkStore();
    const { sink, log } = recorder();
    store.attach(sink);
    store.delete("placedObject", placed(9n, 1, 1));
    expect(log).toEqual([]);
  });
});

describe("ChunkStore ground and roofs (story 3.16)", () => {
  const ground = (id: bigint, x0: number, y0: number, x1: number, y1: number) => ({
    areaId: id,
    defId: 10,
    x0,
    y0,
    x1,
    y1,
    floor: 0,
    chunkKey: chunkKey(x0, y0, 0),
  });
  const roof = (id: bigint, x0: number, y0: number, x1: number, y1: number) => ({
    areaId: id,
    buildingId: 100n,
    defId: 78,
    x0,
    y0,
    x1,
    y1,
    floor: 0,
    chunkKey: chunkKey(x0, y0, 0),
  });

  it("holds ground and roof rects by chunk, and a chunk holding only them still exists", () => {
    const store = new ChunkStore();
    store.insert("groundArea", ground(1n, 0, 0, 4, 4));
    store.insert("roofArea", roof(1n, 40, 0, 44, 4));
    expect([...(store.chunk(chunkKey(0, 0, 0))?.ground.keys() ?? [])]).toEqual([1n]);
    expect([...(store.chunk(chunkKey(40, 0, 0))?.roofs.keys() ?? [])]).toEqual([1n]);
    expect(store.chunkKeys().length).toBe(2);
  });

  it("drops the chunk when its last ground rect goes, and tells listeners", () => {
    const store = new ChunkStore();
    const seen: bigint[] = [];
    store.onChunkChanged((k) => seen.push(k));
    store.insert("groundArea", ground(1n, 0, 0, 4, 4));
    store.delete("groundArea", ground(1n, 0, 0, 4, 4));
    expect(store.chunk(chunkKey(0, 0, 0))).toBeUndefined();
    expect(seen).toEqual([chunkKey(0, 0, 0), chunkKey(0, 0, 0)]);
  });

  it("replaces a row on update, never sinks it into the collision index", () => {
    const store = new ChunkStore();
    const { sink, log } = recorder();
    store.attach(sink);
    store.insert("roofArea", roof(1n, 0, 0, 4, 4));
    store.update("roofArea", roof(1n, 0, 0, 4, 4), roof(1n, 0, 0, 6, 4));
    expect(store.chunk(chunkKey(0, 0, 0))?.roofs.get(1n)?.x1).toBe(6);
    expect(log).toEqual([]);
  });
});
