// The streamed world's rows, held by chunk (story 3.16): what the region
// subscription delivers, as plain data. Nothing here knows the SDK, Pixi or
// the DOM -- `main.ts` feeds it from the subscription's row callbacks and
// the scene reads it. The SDK client cache stays the store of record; this
// is the scene's own per-chunk index of the four tables it draws.
//
// The world is never built from anything but these rows: no client code
// derives geometry the server already knows.

import type { BuildingArea, FloorTransition, PlacedObject, RoomArea } from "../net/bindings/types";

/** What a chunk's rows come to, keyed by each table's own primary key. */
export interface ChunkData {
  readonly placed: Map<bigint, PlacedObject>;
  readonly buildingAreas: Map<bigint, BuildingArea>;
  readonly roomAreas: Map<bigint, RoomArea>;
  readonly transitions: Map<bigint, FloorTransition>;
}

/** The consumers of row changes: the collision/footprint index, the
 * ownership index, the transitions. Called once per change, in order. */
export interface WorldSink {
  placedInserted(row: PlacedObject): void;
  placedDeleted(row: PlacedObject): void;
  buildingAreaInserted(row: BuildingArea): void;
  buildingAreaDeleted(row: BuildingArea): void;
  roomAreaInserted(row: RoomArea): void;
  roomAreaDeleted(row: RoomArea): void;
  transitionInserted?(row: FloorTransition): void;
  transitionDeleted?(row: FloorTransition): void;
}

function emptyChunk(): ChunkData {
  return {
    placed: new Map(),
    buildingAreas: new Map(),
    roomAreas: new Map(),
    transitions: new Map(),
  };
}

type Listener = (chunkKey: bigint) => void;

export class ChunkStore {
  private readonly chunks = new Map<bigint, ChunkData>();
  private readonly applied = new Set<bigint>();
  private readonly sinks: WorldSink[] = [];
  private readonly changeListeners: Listener[] = [];

  /** The rows of one chunk, or none when it holds nothing. */
  chunk(key: bigint): ChunkData | undefined {
    return this.chunks.get(key);
  }

  /** Every chunk that holds at least one row. */
  chunkKeys(): bigint[] {
    return [...this.chunks.keys()];
  }

  /** Registers a sink and replays every held row to it, so a sink attached
   * after rows arrived (the scene mounts after the first region applied)
   * sees the same world as one attached before. */
  attach(sink: WorldSink): void {
    this.sinks.push(sink);
    for (const data of this.chunks.values()) {
      for (const r of data.placed.values()) sink.placedInserted(r);
      for (const r of data.buildingAreas.values()) sink.buildingAreaInserted(r);
      for (const r of data.roomAreas.values()) sink.roomAreaInserted(r);
      for (const r of data.transitions.values()) sink.transitionInserted?.(r);
    }
  }

  /** Called with a chunk key whenever one of its rows changed. */
  onChunkChanged(listener: Listener): void {
    this.changeListeners.push(listener);
  }

  /** A region handle applied: these chunks hold every row they will. */
  markApplied(keys: Iterable<bigint>): void {
    for (const k of keys) this.applied.add(k);
    for (const k of keys) for (const l of this.changeListeners) l(k);
  }

  /** A region handle was released: its chunks are no longer complete. */
  markReleased(keys: Iterable<bigint>): void {
    for (const k of keys) this.applied.delete(k);
  }

  isApplied(key: bigint): boolean {
    return this.applied.has(key);
  }

  insert(table: string, row: object): void {
    this.apply(table, row, true);
  }

  delete(table: string, row: object): void {
    this.apply(table, row, false);
  }

  update(table: string, oldRow: object, row: object): void {
    this.apply(table, oldRow, false);
    this.apply(table, row, true);
  }

  private apply(table: string, row: object, insert: boolean): void {
    switch (table) {
      case "placedObject": {
        const r = row as PlacedObject;
        const data = this.dataFor(r.chunkKey, insert);
        if (!data) return;
        const held = data.placed.get(r.objectId);
        if (insert) {
          if (held) for (const s of this.sinks) s.placedDeleted(held);
          data.placed.set(r.objectId, r);
          for (const s of this.sinks) s.placedInserted(r);
        } else if (held) {
          data.placed.delete(r.objectId);
          for (const s of this.sinks) s.placedDeleted(held);
        }
        this.changed(r.chunkKey);
        return;
      }
      case "buildingArea": {
        const r = row as BuildingArea;
        const data = this.dataFor(r.chunkKey, insert);
        if (!data) return;
        const held = data.buildingAreas.get(r.areaId);
        if (insert) {
          if (held) for (const s of this.sinks) s.buildingAreaDeleted(held);
          data.buildingAreas.set(r.areaId, r);
          for (const s of this.sinks) s.buildingAreaInserted(r);
        } else if (held) {
          data.buildingAreas.delete(r.areaId);
          for (const s of this.sinks) s.buildingAreaDeleted(held);
        }
        this.changed(r.chunkKey);
        return;
      }
      case "roomArea": {
        const r = row as RoomArea;
        const data = this.dataFor(r.chunkKey, insert);
        if (!data) return;
        const held = data.roomAreas.get(r.areaId);
        if (insert) {
          if (held) for (const s of this.sinks) s.roomAreaDeleted(held);
          data.roomAreas.set(r.areaId, r);
          for (const s of this.sinks) s.roomAreaInserted(r);
        } else if (held) {
          data.roomAreas.delete(r.areaId);
          for (const s of this.sinks) s.roomAreaDeleted(held);
        }
        this.changed(r.chunkKey);
        return;
      }
      case "floorTransition": {
        const r = row as FloorTransition;
        const data = this.dataFor(r.chunkKey, insert);
        if (!data) return;
        const held = data.transitions.get(r.transitionId);
        if (insert) {
          if (held) for (const s of this.sinks) s.transitionDeleted?.(held);
          data.transitions.set(r.transitionId, r);
          for (const s of this.sinks) s.transitionInserted?.(r);
        } else if (held) {
          data.transitions.delete(r.transitionId);
          for (const s of this.sinks) s.transitionDeleted?.(held);
        }
        this.changed(r.chunkKey);
        return;
      }
      default:
        // Other region tables (actors, players) are not the world's.
        return;
    }
  }

  private dataFor(key: bigint, create: boolean): ChunkData | undefined {
    let data = this.chunks.get(key);
    if (!data && create) {
      data = emptyChunk();
      this.chunks.set(key, data);
    }
    return data;
  }

  private changed(key: bigint): void {
    const data = this.chunks.get(key);
    if (
      data &&
      data.placed.size === 0 &&
      data.buildingAreas.size === 0 &&
      data.roomAreas.size === 0 &&
      data.transitions.size === 0
    ) {
      this.chunks.delete(key);
    }
    for (const l of this.changeListeners) l(key);
  }
}
