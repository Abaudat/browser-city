import { Timestamp } from "spacetimedb";
import { describe, expect, it } from "vitest";
import { plainPlayerRow } from "../../../src/net/remote-rows";

describe("plainPlayerRow", () => {
  it("hands the frame path plain numbers and strings, no bigint", () => {
    const row = plainPlayerRow({
      characterId: 7n,
      chunkKey: 99n,
      x: -3,
      y: 4,
      floor: 0,
      fracX: 128,
      fracY: 0,
      updatedAt: new Timestamp(1_700_000_000_123_456n),
    });
    expect(row).toEqual({
      characterId: "7",
      tMs: 1_700_000_000_123,
      x: -3,
      y: 4,
      floor: 0,
      fracX: 128,
      fracY: 0,
    });
    for (const v of Object.values(row)) expect(typeof v).not.toBe("bigint");
  });
});
