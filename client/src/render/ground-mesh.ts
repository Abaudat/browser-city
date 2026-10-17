// Story 3.16: a chunk's ground as one static quad list per atlas page -- a
// cell per sprite, every frame, is what a software rasteriser cannot afford.
// Pure: the quads; `world-scene.ts` makes them meshes.

/** Where a def's cell lies on its atlas page, in page UVs. */
export interface GroundFrame {
  readonly page: unknown;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export interface GroundCell {
  readonly defId: number;
  /** The cell inside the chunk. */
  readonly lx: number;
  readonly ly: number;
}

export interface GroundQuads {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

/** The drawn cells of a painted chunk (`paintChunkGround`'s row-major
 * defs, `side` cells a row), skipping `none`. */
export function paintedCells(painted: ArrayLike<number>, side: number, none: number): GroundCell[] {
  const out: GroundCell[] = [];
  for (let ly = 0, i = 0; ly < side; ly++) {
    for (let lx = 0; lx < side; lx++, i++) {
      const defId = painted[i] as number;
      if (defId !== none) out.push({ defId, lx, ly });
    }
  }
  return out;
}

/** The cells' quads, grouped by atlas page, in cell order: each cell a
 * `tileSizePx` square at its whole-pixel offset inside the chunk. */
export function groundQuads(
  cells: readonly GroundCell[],
  frameOf: (defId: number) => GroundFrame,
  tileSizePx: number,
): Map<unknown, GroundQuads> {
  const byPage = new Map<unknown, { cell: GroundCell; frame: GroundFrame }[]>();
  for (const cell of cells) {
    const frame = frameOf(cell.defId);
    const list = byPage.get(frame.page);
    if (list) list.push({ cell, frame });
    else byPage.set(frame.page, [{ cell, frame }]);
  }
  const out = new Map<unknown, GroundQuads>();
  for (const [page, list] of byPage) {
    const positions = new Float32Array(list.length * 8);
    const uvs = new Float32Array(list.length * 8);
    const indices = new Uint32Array(list.length * 6);
    list.forEach(({ cell, frame }, q) => {
      const x0 = cell.lx * tileSizePx;
      const y0 = cell.ly * tileSizePx;
      const x1 = x0 + tileSizePx;
      const y1 = y0 + tileSizePx;
      positions.set([x0, y0, x1, y0, x1, y1, x0, y1], q * 8);
      uvs.set(
        [frame.u0, frame.v0, frame.u1, frame.v0, frame.u1, frame.v1, frame.u0, frame.v1],
        q * 8,
      );
      const v = q * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    });
    out.set(page, { positions, uvs, indices });
  }
  return out;
}

/** A cell rect `[x0, x1) x [y0, y1)`. */
export interface CellRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A roof cell: where it lies in its rect, and which cell of the rooftop
 * panel it shows. */
export interface RoofPiece {
  readonly lx: number;
  readonly ly: number;
  readonly col: number;
  readonly row: number;
}

/** The panel cell along one axis for the cell at offset `i` of an outline
 * `n` cells long, from a panel `p` cells long: the first and last cells
 * are the panel's ends, the cells between repeat its inner cells in order. */
function pieceAlong(i: number, n: number, p: number): number {
  if (p < 3 || i === 0) return 0;
  if (i === n - 1) return p - 1;
  return 1 + ((i - 1) % (p - 2));
}

/** The cells of `rect`, each with the cell of a `panelW` x `panelH` rooftop
 * panel it shows, nine-slice over the building's whole roof `outline`
 * (corners the panel's corners, edges and fill its inner cells repeated,
 * never stretched). */
export function roofPieces(
  rect: CellRect,
  outline: CellRect,
  panelW: number,
  panelH: number,
): RoofPiece[] {
  const out: RoofPiece[] = [];
  const w = outline.x1 - outline.x0;
  const h = outline.y1 - outline.y0;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      out.push({
        lx: x - rect.x0,
        ly: y - rect.y0,
        col: pieceAlong(x - outline.x0, w, panelW),
        row: pieceAlong(y - outline.y0, h, panelH),
      });
    }
  }
  return out;
}

/** Quads for cells that each carry their own frame, grouped by page. */
export function framedQuads(
  cells: readonly { readonly lx: number; readonly ly: number; readonly frame: GroundFrame }[],
  tileSizePx: number,
): Map<unknown, GroundQuads> {
  let next = 0;
  const frames = new Map<number, GroundFrame>();
  const keyed = cells.map((c) => {
    const id = next++;
    frames.set(id, c.frame);
    return { defId: id, lx: c.lx, ly: c.ly };
  });
  return groundQuads(keyed, (id) => frames.get(id) as GroundFrame, tileSizePx);
}
