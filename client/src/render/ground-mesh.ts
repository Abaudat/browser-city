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
