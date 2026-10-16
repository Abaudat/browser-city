// Story 3.16: a chunk's ground is its rects painted in row order over open
// ground, and the open-ground def is found by tags, never by key.
import { describe, expect, it } from "vitest";
import { NO_GROUND, openGroundDefId, paintChunkGround } from "../../../src/render/ground-paint";
import { CHUNK_SIZE } from "../../../src/world/chunk";

const rect = (areaId: number, defId: number, x0: number, y0: number, x1: number, y1: number) => ({
  areaId: BigInt(areaId),
  defId,
  x0,
  y0,
  x1,
  y1,
});
const at = (cells: Int32Array, x: number, y: number) => cells[y * CHUNK_SIZE + x];

describe("paintChunkGround", () => {
  it("is open ground wherever no rect covers a cell", () => {
    const cells = paintChunkGround([], 0, 0, 9);
    expect(cells.length).toBe(CHUNK_SIZE * CHUNK_SIZE);
    expect(cells.every((c) => c === 9)).toBe(true);
  });

  it("is nothing on a floor with no open ground", () => {
    const cells = paintChunkGround([rect(1, 4, 0, 0, 2, 2)], 0, 0, NO_GROUND);
    expect(at(cells, 0, 0)).toBe(4);
    expect(at(cells, 2, 2)).toBe(NO_GROUND);
  });

  it("paints a later row over an earlier one, whatever order rows arrive in", () => {
    const rows = [rect(2, 11, 4, 0, 8, 32), rect(1, 10, 0, 0, 32, 32)];
    const cells = paintChunkGround(rows, 0, 0, 9);
    expect(at(cells, 3, 5)).toBe(10);
    expect(at(cells, 5, 5)).toBe(11);
  });

  it("reads a chunk's own window of world coordinates, negative chunks included", () => {
    const rows = [rect(1, 10, -32, 32, 0, 64)];
    const cells = paintChunkGround(rows, -1, 1, 9);
    expect(at(cells, 0, 0)).toBe(10);
    expect(at(cells, 31, 31)).toBe(10);
    expect(paintChunkGround(rows, 0, 1, 9).every((c) => c === 9)).toBe(true);
  });

  it("clips a rect that reaches past the chunk", () => {
    const cells = paintChunkGround([rect(1, 10, 30, 30, 40, 40)], 0, 0, 9);
    expect(at(cells, 31, 31)).toBe(10);
    expect(at(cells, 29, 29)).toBe(9);
  });
});

describe("openGroundDefId", () => {
  const OPEN = 2;

  it("is the open-role def with the fewest other tags, never a yard or a roof", () => {
    const objects = [
      { id: 30, tags: [1, 2, 3] },
      { id: 20, tags: [1, 2, 4, 5] },
      { id: 9, tags: [1, 2] },
      { id: 5, tags: [1] },
    ];
    expect(openGroundDefId(objects, OPEN)).toBe(9);
  });

  it("is the lowest such id, and undefined when no def carries the tag", () => {
    expect(
      openGroundDefId(
        [
          { id: 8, tags: [2, 1] },
          { id: 7, tags: [2] },
        ],
        OPEN,
      ),
    ).toBe(7);
    expect(openGroundDefId([{ id: 1, tags: [3] }], OPEN)).toBeUndefined();
  });
});
