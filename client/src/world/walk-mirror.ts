// A chunked copy of the tile walkability, for a solver that runs on another
// thread (D-L3): the main thread's `WalkFeed` reads the live walkability for
// the chunks that changed and sends them; `WalkMirror` answers `walkable` from
// them with the same answers. A chunk never sent reads as empty, as a chunk
// that has not streamed in does on the main thread. Pure: no Pixi, no clock.

import { CHUNK_SIZE } from "./chunk";

/** What a body's pathing and wall scans ask of the world. */
export interface MirroredWalkability {
  revision(): number;
  walkable(floor: number, x: number, y: number): boolean;
}

function chunkId(floor: number, cx: number, cy: number): number {
  return (floor + 128) * 2 ** 40 + (cx + 2 ** 19) * 2 ** 20 + (cy + 2 ** 19);
}

export class WalkMirror implements MirroredWalkability {
  readonly #chunks = new Map<number, Uint8Array>();
  #revision = 0;
  #memoKey = Number.NaN;
  #memo: Uint8Array | undefined;

  revision(): number {
    return this.#revision;
  }

  /** Replaces (or, with `null`, frees) one chunk and moves the revision. */
  setChunk(floor: number, cx: number, cy: number, blocked: Uint8Array | null): void {
    const key = chunkId(floor, cx, cy);
    if (blocked === null) this.#chunks.delete(key);
    else this.#chunks.set(key, blocked);
    this.#memoKey = Number.NaN;
    this.#revision++;
  }

  walkable(floor: number, x: number, y: number): boolean {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const key = chunkId(floor, cx, cy);
    if (key !== this.#memoKey) {
      this.#memo = this.#chunks.get(key);
      this.#memoKey = key;
    }
    const chunk = this.#memo;
    if (chunk === undefined) return true;
    return chunk[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)] === 0;
  }
}

/** Where the chunks that changed come from (the collision grid). */
export interface ChangedChunks {
  /** Calls `fn` once per chunk changed since the last drain, then forgets them. */
  drainChangedChunks(fn: (floor: number, cx: number, cy: number) => void): void;
  /** Calls `fn` once for every chunk that holds anything now. */
  allChunks(fn: (floor: number, cx: number, cy: number) => void): void;
}

/** One chunk of change for the mirror. */
export interface FedChunk {
  readonly floor: number;
  readonly cx: number;
  readonly cy: number;
  readonly blocked: Uint8Array | null;
}

const NONE: FedChunk[] = [];

/** Reads the live walkability for each changed chunk, ready to send. */
export class WalkFeed {
  readonly #walk: MirroredWalkability;
  readonly #source: ChangedChunks;
  readonly #seedRects: readonly { x0: number; y0: number; x1: number; y1: number; floor: number }[];
  /** Chunks the source does not know to be non-empty, sent once at start. */
  readonly #seed: { floor: number; cx: number; cy: number }[] = [];

  constructor(
    walk: MirroredWalkability,
    source: ChangedChunks,
    /** Cell rects the walkability blocks without the source knowing: their
     * chunks are sent once. */
    seedRects: readonly { x0: number; y0: number; x1: number; y1: number; floor: number }[] = [],
  ) {
    this.#walk = walk;
    this.#source = source;
    this.#seedRects = seedRects;
    const seen = new Set<number>();
    for (const r of seedRects) {
      for (let cy = Math.floor(r.y0 / CHUNK_SIZE); cy <= Math.floor(r.y1 / CHUNK_SIZE); cy++) {
        for (let cx = Math.floor(r.x0 / CHUNK_SIZE); cx <= Math.floor(r.x1 / CHUNK_SIZE); cx++) {
          const key = chunkId(r.floor, cx, cy);
          if (seen.has(key)) continue;
          seen.add(key);
          this.#seed.push({ floor: r.floor, cx, cy });
        }
      }
    }
  }

  /** Every chunk that holds anything, read now: what a new solver is given in
   * full where a running one gets deltas. Does not touch the changed set. */
  collectAll(): FedChunk[] {
    const out: FedChunk[] = [];
    const seen = new Set<number>();
    const add = (floor: number, cx: number, cy: number): void => {
      const key = chunkId(floor, cx, cy);
      if (seen.has(key)) return;
      seen.add(key);
      const chunk = this.#readChunk(floor, cx, cy);
      if (chunk) out.push(chunk);
    };
    for (const r of this.#seedRects) {
      for (let cy = Math.floor(r.y0 / CHUNK_SIZE); cy <= Math.floor(r.y1 / CHUNK_SIZE); cy++) {
        for (let cx = Math.floor(r.x0 / CHUNK_SIZE); cx <= Math.floor(r.x1 / CHUNK_SIZE); cx++) {
          add(r.floor, cx, cy);
        }
      }
    }
    this.#source.allChunks(add);
    return out;
  }

  #readChunk(floor: number, cx: number, cy: number): FedChunk | undefined {
    const blocked = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    let any = false;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (!this.#walk.walkable(floor, cx * CHUNK_SIZE + lx, cy * CHUNK_SIZE + ly)) {
          blocked[ly * CHUNK_SIZE + lx] = 1;
          any = true;
        }
      }
    }
    return any ? { floor, cx, cy, blocked } : undefined;
  }

  /** The chunks that changed since the last call; empty most frames, and then
   * no allocation at all. */
  collect(): FedChunk[] {
    this.#out = undefined;
    for (const s of this.#seed) this.#note(s.floor, s.cx, s.cy);
    this.#seed.length = 0;
    this.#source.drainChangedChunks(this.#noteChanged);
    const out = this.#out ?? NONE;
    this.#out = undefined;
    return out;
  }

  #out: FedChunk[] | undefined;
  readonly #noteChanged = (floor: number, cx: number, cy: number): void =>
    this.#note(floor, cx, cy);

  #note(floor: number, cx: number, cy: number): void {
    const out = this.#out ?? [];
    this.#out = out;
    for (const c of out) if (c.floor === floor && c.cx === cx && c.cy === cy) return;
    const blocked = this.#readChunk(floor, cx, cy);
    out.push({ floor, cx, cy, blocked: blocked ? blocked.blocked : null });
  }
}
