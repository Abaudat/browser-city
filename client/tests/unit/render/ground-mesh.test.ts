// Story 3.16: a chunk's ground is one static quad list per atlas page, never
// a sprite per cell.

import { describe, expect, it } from "vitest";
import { groundQuads } from "../../../src/render/ground-mesh";

/** Two pages; def 1 and 2 on page "a", def 3 on page "b". */
const frames = new Map([
  [1, { page: "a", u0: 0, v0: 0, u1: 0.5, v1: 0.5 }],
  [2, { page: "a", u0: 0.5, v0: 0, u1: 1, v1: 0.5 }],
  [3, { page: "b", u0: 0, v0: 0.5, u1: 0.25, v1: 1 }],
]);

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
