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

  /** The chunks that changed since the last call; empty most frames. */
  collect(): FedChunk[] {
    let out: FedChunk[] | undefined;
    let seen: Set<number> | undefined;
    const read = (floor: number, cx: number, cy: number): void => {
      const key = chunkId(floor, cx, cy);
      out ??= [];
      seen ??= new Set();
      if (seen.has(key)) return;
      seen.add(key);
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
      out.push({ floor, cx, cy, blocked: any ? blocked : null });
    };
    for (const s of this.#seed) read(s.floor, s.cx, s.cy);
    this.#seed.length = 0;
    this.#source.drainChangedChunks(read);
    return out ?? NONE;
  }
}
