// The committed fixture block (`fixtures/fixture-block.v1.json`, restored by
// the e2e harness) is what `tests/fixture-block/block.ts` builds, and holds
// nothing the generated world could not: real defs, ids 1..N, every row
// inside one chunk.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkKey } from "../../../src/world/chunk";
import { buildBlock } from "../../fixture-block/block";
import { BLOCK_FIXTURE_PATH, blockDocument } from "../../fixture-block/block-document";
import { committedDefs } from "../support/committed-defs";

describe("the e2e fixture block", () => {
  it("is the committed dump", () => {
    expect(readFileSync(BLOCK_FIXTURE_PATH, "utf-8")).toBe(blockDocument());
  });

  it("places only real defs, with ids 1..N and a chunk key that is its anchor's", () => {
    const block = buildBlock();
    const known = new Set(committedDefs().objects.map((o) => o.id));
    block.placed.forEach((row, index) => {
      const [id, def, x, y, floor, , , key] = row;
      expect(id).toBe(index + 1);
      expect(known.has(def), `def ${def}`).toBe(true);
      expect(key).toBe(chunkKey(x, y, floor).toString());
    });
    expect(block.cupboard.objectId).toBe(block.placed.length);
    expect(block.maxId).toBeGreaterThanOrEqual(block.placed.length);
  });

  it("keeps every ground rect inside the one chunk its key names", () => {
    for (const [, , x0, y0, x1, y1, floor, key] of buildBlock().ground) {
      expect(chunkKey(x0, y0, floor).toString()).toBe(key);
      expect(chunkKey(x1 - 1, y1 - 1, floor).toString()).toBe(key);
    }
  });
});
