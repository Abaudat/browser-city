// Tile-level A* between two cells (FR63): 4-connected, deterministic, straight
// moves preferred, kept near the straight line between the endpoints, bounded
// to the endpoints' box inflated by a margin, to a cell cap and to a node
// budget. The tile path is then pulled taut into the fewest straight edges
// that keep clear of every blocked tile, so a sidestep is a drift, not two
// right angles. Total: a path or a typed failure, never a throw.

/** What L3 may know about the world: whether a tile is walkable, and a
 * revision that moves whenever that may have changed. */
export interface Walkability {
  revision(): number;
  walkable(floor: number, x: number, y: number): boolean;
}

export interface PathConfig {
  readonly marginCells: number;
  readonly nodeBudget: number;
  /** A search box with more cells than this is refused before it is allocated. */
  readonly maxCells: number;
}

export type MicroPath =
  | {
      readonly ok: true;
      /** x0, y0, x1, y1, ... tile addresses, start to goal inclusive. */
      readonly cells: Float64Array;
      /** x0, y0, x1, y1, ... the taut route through tile centres. */
      readonly route: Float64Array;
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
/** Cost per cell of distance from the straight line, per step. Small against
 * STEP so the path stays shortest, large against TURN so a detour returns to
 * the line at once. */
const OFF_LINE = 20;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const NONE = -1;
/** How far either side of its centre line a body keeps from a blocked tile. */
const CLEARANCE = 0.3;
/** Sampling step along a candidate edge, in cells. */
const SAMPLE = 0.1;
/** The farthest ahead, in tiles, a taut edge is tried. */
const LOOKAHEAD = 16;

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
    const ka = this.#keys[a] as number;
    const kb = this.#keys[b] as number;
    return ka < kb || (ka === kb && (this.#seqs[a] as number) < (this.#seqs[b] as number));
  }

  #swap(a: number, b: number): void {
    const n = this.#nodes[a] as number;
    const k = this.#keys[a] as number;
    const s = this.#seqs[a] as number;
    this.#nodes[a] = this.#nodes[b] as number;
    this.#keys[a] = this.#keys[b] as number;
    this.#seqs[a] = this.#seqs[b] as number;
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
    const top = this.#nodes[0] as number;
    this.size--;
    if (this.size > 0) {
      this.#nodes[0] = this.#nodes[this.size] as number;
      this.#keys[0] = this.#keys[this.size] as number;
      this.#seqs[0] = this.#seqs[this.size] as number;
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

/** Whether a body standing at `(x, y)` (cell units) is clear of blocked tiles. */
function clearAt(
  walkable: (x: number, y: number) => boolean,
  start: Point,
  x: number,
  y: number,
): boolean {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  if (fx === start.x && fy === start.y) return true;
  return (
    walkable(fx, fy) &&
    walkable(Math.floor(x + CLEARANCE), fy) &&
    walkable(Math.floor(x - CLEARANCE), fy) &&
    walkable(fx, Math.floor(y + CLEARANCE)) &&
    walkable(fx, Math.floor(y - CLEARANCE))
  );
}

function lineIsClear(
  walkable: (x: number, y: number) => boolean,
  start: Point,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const length = Math.hypot(bx - ax, by - ay);
  const steps = Math.ceil(length / SAMPLE);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    if (!clearAt(walkable, start, ax + (bx - ax) * f, ay + (by - ay) * f)) return false;
  }
  return true;
}

/** The tile path pulled taut: from each kept point, the goal if it can be
 * reached in a straight clear line, else the farthest later point (within
 * LOOKAHEAD tiles) that can. So open ground of any length is one edge. */
function pullTaut(
  walkable: (x: number, y: number) => boolean,
  start: Point,
  cells: Float64Array,
): Float64Array {
  const count = cells.length / 2;
  const kept: number[] = [0];
  let i = 0;
  while (i < count - 1) {
    const last = count - 1;
    const goalInSight = lineIsClear(
      walkable,
      start,
      (cells[i * 2] as number) + 0.5,
      (cells[i * 2 + 1] as number) + 0.5,
      (cells[last * 2] as number) + 0.5,
      (cells[last * 2 + 1] as number) + 0.5,
    );
    let j = goalInSight ? last : Math.min(last, i + LOOKAHEAD);
    while (
      !goalInSight &&
      j > i + 1 &&
      !lineIsClear(
        walkable,
        start,
        (cells[i * 2] as number) + 0.5,
        (cells[i * 2 + 1] as number) + 0.5,
        (cells[j * 2] as number) + 0.5,
        (cells[j * 2 + 1] as number) + 0.5,
      )
    ) {
      j--;
    }
    kept.push(j);
    i = j;
  }
  const route = new Float64Array(kept.length * 2);
  kept.forEach((index, k) => {
    route[k * 2] = (cells[index * 2] as number) + 0.5;
    route[k * 2 + 1] = (cells[index * 2 + 1] as number) + 0.5;
  });
  return route;
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
  maxCells: number,
): MicroPath {
  if (from.x === to.x && from.y === to.y) {
    return {
      ok: true,
      cells: Float64Array.of(from.x, from.y),
      route: Float64Array.of(from.x + 0.5, from.y + 0.5),
      expansions: 0,
    };
  }
  if (!walkable(to.x, to.y)) return { ok: false, reason: "blocked_goal", expansions: 0 };

  const minX = Math.min(from.x, to.x) - marginCells;
  const minY = Math.min(from.y, to.y) - marginCells;
  const w = Math.max(from.x, to.x) + marginCells - minX + 1;
  const h = Math.max(from.y, to.y) + marginCells - minY + 1;
  const total = w * h;
  if (!(total <= maxCells)) return { ok: false, reason: "budget", expansions: 0 };
  const g = new Int32Array(total).fill(NONE);
  const parent = new Int32Array(total).fill(NONE);
  const dirOf = new Int8Array(total).fill(NONE);
  const closed = new Uint8Array(total);
  const heap = new Heap(64);

  const startIdx = (from.y - minY) * w + (from.x - minX);
  const goalIdx = (to.y - minY) * w + (to.x - minX);
  const heuristic = (x: number, y: number): number =>
    (Math.abs(to.x - x) + Math.abs(to.y - y)) * STEP;
  const lineDx = to.x - from.x;
  const lineDy = to.y - from.y;
  const lineLength = Math.hypot(lineDx, lineDy);
  const offLine = (x: number, y: number): number =>
    Math.round((Math.abs((x - from.x) * lineDy - (y - from.y) * lineDx) / lineLength) * OFF_LINE);

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
    const gHere = g[idx] as number;
    const heading = dirOf[idx] as number;
    for (let d = 0; d < 4; d++) {
      const nx = x + (DX[d] as number);
      const ny = y + (DY[d] as number);
      const lx = nx - minX;
      const ly = ny - minY;
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
      const nIdx = ly * w + lx;
      if (closed[nIdx] || !walkable(nx, ny)) continue;
      const cost = gHere + STEP + offLine(nx, ny) + (heading !== NONE && heading !== d ? TURN : 0);
      const known = g[nIdx] as number;
      if (known !== NONE && cost >= known) continue;
      g[nIdx] = cost;
      parent[nIdx] = idx;
      dirOf[nIdx] = d;
      heap.push(nIdx, cost + heuristic(nx, ny));
    }
  }

  if (!closed[goalIdx]) return { ok: false, reason: "unreachable", expansions };

  let length = 1;
  for (let i = goalIdx; i !== startIdx; i = parent[i] as number) length++;
  const cells = new Float64Array(length * 2);
  let i = goalIdx;
  for (let k = length - 1; k >= 0; k--) {
    cells[k * 2] = (i % w) + minX;
    cells[k * 2 + 1] = Math.floor(i / w) + minY;
    i = parent[i] as number;
  }
  return { ok: true, cells, route: pullTaut(walkable, from, cells), expansions };
}
