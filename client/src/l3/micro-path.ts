// Tile-level A* between two cells (FR63): 4-connected, deterministic, straight
// moves preferred, bounded to the endpoints' box inflated by a margin and to
// a node budget. Total: a path or a typed failure, never a throw.

/** What L3 may know about the world: whether a tile is walkable, and a
 * revision that moves whenever that may have changed. */
export interface Walkability {
  revision(): number;
  walkable(floor: number, x: number, y: number): boolean;
}

export interface PathConfig {
  readonly marginCells: number;
  readonly nodeBudget: number;
}

export type MicroPath =
  | {
      readonly ok: true;
      /** x0, y0, x1, y1, ... cell addresses, start to goal inclusive. */
      readonly cells: Int32Array;
      readonly expansions: number;
    }
  | {
      readonly ok: false;
      readonly reason: "blocked_goal" | "unreachable" | "budget";
      readonly expansions: number;
    };

interface Point {
  readonly x: number;
  readonly y: number;
}

const STEP = 1000;
const TURN = 1;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const NONE = -1;

/** A binary min-heap of (key, seq) pairs held in typed arrays. */
class Heap {
  #nodes: Int32Array;
  #keys: Float64Array;
  #seqs: Float64Array;
  size = 0;
  #seq = 0;

  constructor(capacity: number) {
    this.#nodes = new Int32Array(capacity);
    this.#keys = new Float64Array(capacity);
    this.#seqs = new Float64Array(capacity);
  }

  #less(a: number, b: number): boolean {
    const ka = this.#keys[a] ?? 0;
    const kb = this.#keys[b] ?? 0;
    return ka < kb || (ka === kb && (this.#seqs[a] ?? 0) < (this.#seqs[b] ?? 0));
  }

  #swap(a: number, b: number): void {
    const n = this.#nodes[a] ?? 0;
    const k = this.#keys[a] ?? 0;
    const s = this.#seqs[a] ?? 0;
    this.#nodes[a] = this.#nodes[b] ?? 0;
    this.#keys[a] = this.#keys[b] ?? 0;
    this.#seqs[a] = this.#seqs[b] ?? 0;
    this.#nodes[b] = n;
    this.#keys[b] = k;
    this.#seqs[b] = s;
  }

  push(node: number, key: number): void {
    if (this.size === this.#nodes.length) {
      const grow = this.size * 2;
      const nodes = new Int32Array(grow);
      const keys = new Float64Array(grow);
      const seqs = new Float64Array(grow);
      nodes.set(this.#nodes);
      keys.set(this.#keys);
      seqs.set(this.#seqs);
      this.#nodes = nodes;
      this.#keys = keys;
      this.#seqs = seqs;
    }
    let i = this.size++;
    this.#nodes[i] = node;
    this.#keys[i] = key;
    this.#seqs[i] = this.#seq++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.#less(i, parent)) break;
      this.#swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.#nodes[0] ?? 0;
    this.size--;
    if (this.size > 0) {
      this.#nodes[0] = this.#nodes[this.size] ?? 0;
      this.#keys[0] = this.#keys[this.size] ?? 0;
      this.#seqs[0] = this.#seqs[this.size] ?? 0;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.#less(l, m)) m = l;
        if (r < this.size && this.#less(r, m)) m = r;
        if (m === i) break;
        this.#swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/** The path from `from` to `to` over `walkable`. The start tile is always
 * leavable (a body whose own tile became blocked may walk out of it); the
 * goal must be walkable. */
export function findMicroPath(
  walkable: (x: number, y: number) => boolean,
  from: Point,
  to: Point,
  marginCells: number,
  nodeBudget: number,
): MicroPath {
  if (from.x === to.x && from.y === to.y) {
    return { ok: true, cells: Int32Array.of(from.x, from.y), expansions: 0 };
  }
  if (!walkable(to.x, to.y)) return { ok: false, reason: "blocked_goal", expansions: 0 };

  const minX = Math.min(from.x, to.x) - marginCells;
  const minY = Math.min(from.y, to.y) - marginCells;
  const w = Math.max(from.x, to.x) + marginCells - minX + 1;
  const h = Math.max(from.y, to.y) + marginCells - minY + 1;
  const total = w * h;
  const g = new Int32Array(total).fill(NONE);
  const parent = new Int32Array(total).fill(NONE);
  const dirOf = new Int8Array(total).fill(NONE);
  const closed = new Uint8Array(total);
  const heap = new Heap(64);

  const startIdx = (from.y - minY) * w + (from.x - minX);
  const goalIdx = (to.y - minY) * w + (to.x - minX);
  const heuristic = (x: number, y: number): number =>
    (Math.abs(to.x - x) + Math.abs(to.y - y)) * STEP;

  g[startIdx] = 0;
  heap.push(startIdx, heuristic(from.x, from.y));
  let expansions = 0;

  while (heap.size > 0) {
    const idx = heap.pop();
    if (closed[idx]) continue;
    closed[idx] = 1;
    expansions++;
    if (idx === goalIdx) break;
    if (expansions > nodeBudget) return { ok: false, reason: "budget", expansions };
    const x = (idx % w) + minX;
    const y = Math.floor(idx / w) + minY;
    const gHere = g[idx] ?? 0;
    const heading = dirOf[idx] ?? NONE;
    for (let d = 0; d < 4; d++) {
      const nx = x + (DX[d] ?? 0);
      const ny = y + (DY[d] ?? 0);
      const lx = nx - minX;
      const ly = ny - minY;
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
      const nIdx = ly * w + lx;
      if (closed[nIdx] || !walkable(nx, ny)) continue;
      const cost = gHere + STEP + (heading !== NONE && heading !== d ? TURN : 0);
      const known = g[nIdx] ?? NONE;
      if (known !== NONE && cost >= known) continue;
      g[nIdx] = cost;
      parent[nIdx] = idx;
      dirOf[nIdx] = d;
      heap.push(nIdx, cost + heuristic(nx, ny));
    }
  }

  if (!closed[goalIdx]) return { ok: false, reason: "unreachable", expansions };

  let length = 1;
  for (let i = goalIdx; i !== startIdx; i = parent[i] ?? startIdx) length++;
  const cells = new Int32Array(length * 2);
  let i = goalIdx;
  for (let k = length - 1; k >= 0; k--) {
    cells[k * 2] = (i % w) + minX;
    cells[k * 2 + 1] = Math.floor(i / w) + minY;
    i = parent[i] ?? startIdx;
  }
  return { ok: true, cells, expansions };
}
