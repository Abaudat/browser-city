// Story 3.16: a chunk's ground is one static quad list per atlas page, never
// a sprite per cell.

import { describe, expect, it } from "vitest";
import { groundQuads, paintedCells, roofPieces } from "../../../src/render/ground-mesh";

/** Two pages; def 1 and 2 on page "a", def 3 on page "b". */
const frames = new Map([
  [1, { page: "a", u0: 0, v0: 0, u1: 0.5, v1: 0.5 }],
  [2, { page: "a", u0: 0.5, v0: 0, u1: 1, v1: 0.5 }],
  [3, { page: "b", u0: 0, v0: 0.5, u1: 0.25, v1: 1 }],
]);

describe("paintedCells", () => {
  it("reads a row-major chunk into cells, skipping the none def", () => {
    expect(paintedCells([7, -1, -1, 8], 2, -1)).toEqual([
      { defId: 7, lx: 0, ly: 0 },
      { defId: 8, lx: 1, ly: 1 },
    ]);
  });
});

describe("groundQuads", () => {
  it("groups the cells by page, one quad per cell at its whole-pixel offset", () => {
    const cells = [
      { defId: 1, lx: 0, ly: 0 },
      { defId: 3, lx: 1, ly: 0 },
      { defId: 2, lx: 0, ly: 2 },
    ];
    const pages = groundQuads(cells, (id) => frames.get(id) as never, 16);
    expect([...pages.keys()].sort()).toEqual(["a", "b"]);
    const a = pages.get("a");
    expect(a?.indices.length).toBe(12);
    // The second quad of page "a" is cell (0, 2): x 0..16, y 32..48.
    expect([...(a?.positions.slice(8, 16) ?? [])]).toEqual([0, 32, 16, 32, 16, 48, 0, 48]);
    expect([...(a?.uvs.slice(8, 16) ?? [])]).toEqual([0.5, 0, 1, 0, 1, 0.5, 0.5, 0.5]);
    expect([...(a?.indices.slice(6, 12) ?? [])]).toEqual([4, 5, 6, 4, 6, 7]);
    const b = pages.get("b");
    expect([...(b?.positions ?? [])]).toEqual([16, 0, 32, 0, 32, 16, 16, 16]);
  });

  it("draws nothing for no cells", () => {
    expect(groundQuads([], () => undefined as never, 16).size).toBe(0);
  });
});

describe("roofPieces", () => {
  // A 5x4-cell roof outline from a 3x3 panel: corners are the panel's
  // corners, edges and fill repeat the panel's inner cells, never stretched.
  const outline = { x0: 10, y0: 20, x1: 15, y1: 24 };
  it("lays corners, edges and fill of the panel over the whole outline", () => {
    const cells = roofPieces({ x0: 10, y0: 20, x1: 15, y1: 24 }, outline, 3, 3);
    const at = (x: number, y: number) => cells.find((c) => c.lx === x - 10 && c.ly === y - 20);
    expect(at(10, 20)).toMatchObject({ col: 0, row: 0 });
    expect(at(14, 20)).toMatchObject({ col: 2, row: 0 });
    expect(at(10, 23)).toMatchObject({ col: 0, row: 2 });
    expect(at(14, 23)).toMatchObject({ col: 2, row: 2 });
    expect(at(12, 20)).toMatchObject({ col: 1, row: 0 });
    expect(at(10, 21)).toMatchObject({ col: 0, row: 1 });
    expect(at(12, 22)).toMatchObject({ col: 1, row: 1 });
    expect(cells).toHaveLength(20);
  });

  it("repeats a wider panel's inner cells in order", () => {
    const cells = roofPieces({ x0: 0, y0: 0, x1: 8, y1: 3 }, { x0: 0, y0: 0, x1: 8, y1: 3 }, 4, 3);
    expect(cells.filter((c) => c.ly === 1).map((c) => c.col)).toEqual([0, 1, 2, 1, 2, 1, 2, 3]);
  });

  it("reads a rect of the outline by its place in the outline, from the rect's own origin", () => {
    // The north rim strip west of a door: the outline's top row.
    const cells = roofPieces({ x0: 10, y0: 20, x1: 12, y1: 21 }, outline, 3, 3);
    expect(cells).toEqual([
      { lx: 0, ly: 0, col: 0, row: 0 },
      { lx: 1, ly: 0, col: 1, row: 0 },
    ]);
  });
});
