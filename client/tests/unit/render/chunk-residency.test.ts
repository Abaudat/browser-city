import { describe, expect, it } from "vitest";
import { chunkResidency, DRAW_MARGIN_CELLS } from "../../../src/render/chunk-residency";
import { CHUNK_SIZE, chunkKey } from "../../../src/world/chunk";

const view = { x0: 40, y0: 40, x1: 80, y1: 62 };

describe("chunkResidency (story 3.16)", () => {
  it("wants every chunk the viewport and its margin touch, and no other", () => {
    const keys = [0, 1, 2, 3, 4, 5].flatMap((cx) =>
      [0, 1, 2, 3].map((cy) => chunkKey(cx * CHUNK_SIZE, cy * CHUNK_SIZE, 0)),
    );
    const { draw } = chunkResidency(keys, [], view, 0);
    const wanted = new Set(draw);
    // The viewport spans x 40..80 (chunks 1..2), y 40..62 (chunk 1); the
    // margin reaches chunks 0..3 on x and 0..2 on y.
    const lo = 40 - DRAW_MARGIN_CELLS;
    const hi = 80 + DRAW_MARGIN_CELLS;
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = 0; cy < 4; cy++) {
        const touches =
          cx * CHUNK_SIZE < hi &&
          (cx + 1) * CHUNK_SIZE > lo &&
          cy * CHUNK_SIZE < 62 + DRAW_MARGIN_CELLS &&
          (cy + 1) * CHUNK_SIZE > 40 - DRAW_MARGIN_CELLS;
        expect(wanted.has(chunkKey(cx * CHUNK_SIZE, cy * CHUNK_SIZE, 0))).toBe(touches);
      }
    }
  });

  it("keeps a drawn chunk until it is a whole chunk past the margin (no thrash)", () => {
    const drawn = chunkKey(0, 0, 0);
    const near = chunkResidency([drawn], [drawn], { x0: 100, y0: 0, x1: 140, y1: 22 }, 0);
    // Not wanted any more (cx 0 ends at 32; the margin reaches 100 - 12 = 88)...
    expect(near.draw).not.toContain(drawn);
    // ...but not dropped either: still within a chunk of the margin? No: 88 - 32 = 56 > 32.
    expect(near.drop).toContain(drawn);
    const just = chunkResidency([drawn], [drawn], { x0: 60, y0: 0, x1: 100, y1: 22 }, 0);
    expect(just.draw).not.toContain(drawn);
    expect(just.drop).not.toContain(drawn);
  });

  it("only considers chunks on the floors it is asked for", () => {
    const street = chunkKey(40, 40, 0);
    const subway = chunkKey(40, 40, -1);
    const { draw } = chunkResidency([street, subway], [], view, 0);
    expect(draw).toContain(street);
    expect(draw).toContain(subway);
    const only = chunkResidency([street, subway], [], view, 0, (f) => f >= 0);
    expect(only.draw).toEqual([street]);
  });

  it("orders what to draw nearest the viewport centre first", () => {
    const keys = [chunkKey(0, 0, 0), chunkKey(64, 32, 0), chunkKey(32, 32, 0)];
    const { draw } = chunkResidency(keys, [], { x0: 40, y0: 40, x1: 80, y1: 62 }, 0);
    expect(draw.slice(0, 2)).toEqual([chunkKey(32, 32, 0), chunkKey(64, 32, 0)]);
  });
});
