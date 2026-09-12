import { describe, expect, it } from "vitest";
import {
  buildLayerRankTable,
  resolveRank,
  UnknownLayerCodeError,
} from "../../../src/render/layer-ranks";

// Mirrors `server/sim/tests/goldens/codes_v1.golden`'s `layer` rows --
// fixture data for this test file only, never a second production source
// of the ranks themselves (the real table is built from live subscribed
// `layer_code` rows, `buildLayerRankTable`'s only caller-supplied input).
const LIVE_ROWS = [
  { code: 0, rank: 0 },
  { code: 1, rank: 1 }, // overhead: deprecated, still seeded server-side
  { code: 2, rank: 10 },
  { code: 3, rank: 20 },
  { code: 4, rank: 30 },
  { code: 5, rank: 40 },
  { code: 6, rank: 50 },
];

describe("buildLayerRankTable / resolveRank", () => {
  it("resolves the rank for every live, non-deprecated code", () => {
    const table = buildLayerRankTable(LIVE_ROWS);
    expect(resolveRank(table, 0)).toBe(0);
    expect(resolveRank(table, 2)).toBe(10);
    expect(resolveRank(table, 6)).toBe(50);
  });

  it("throws for a deprecated code, even though its row is still seeded", () => {
    const table = buildLayerRankTable(LIVE_ROWS);
    expect(() => resolveRank(table, 1)).toThrow(UnknownLayerCodeError);
  });

  it("throws for a code with no row at all, rather than falling back silently", () => {
    const table = buildLayerRankTable(LIVE_ROWS);
    expect(() => resolveRank(table, 999)).toThrow(UnknownLayerCodeError);
  });

  it("never includes a deprecated code in the built table", () => {
    const table = buildLayerRankTable(LIVE_ROWS);
    expect(table.has(1)).toBe(false);
  });
});
