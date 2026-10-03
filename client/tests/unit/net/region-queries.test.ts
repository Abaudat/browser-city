import fc from "fast-check";
import { toSql } from "spacetimedb";
import { describe, expect, it } from "vitest";
import { REGION_QUERIES, regionQueries } from "../../../src/net/region-subscription";
import { chunkKeysOfHandle } from "../../../src/world/region";

const FLOORS = { minFloor: -1, maxFloor: 7 };
const SHAPE = /^SELECT \* FROM "([a-z_]+)" WHERE "\1"\."chunk_key" = (\d+)$/;

describe("regionQueries", () => {
  // the emitted literal parses back to the exact bigint key
  it("inv_interest_chunk_keys_survive_the_query_string", () => {
    const coord = fc.oneof(
      fc.integer({ min: -(2 ** 23), max: 2 ** 23 - 1 }),
      fc.constantFrom(-(2 ** 23), 2 ** 23 - 1, -1, 0, 1),
    );
    fc.assert(
      fc.property(coord, coord, fc.constantFrom<0 | 1>(0, 1), (cx, cy, band) => {
        const key = { cx, cy, band };
        const keys = chunkKeysOfHandle(key, FLOORS);
        const sql = regionQueries(key, FLOORS).map((q) => toSql(q));
        expect(sql.length).toBe(REGION_QUERIES.length * keys.length);
        sql.forEach((s, i) => {
          const m = SHAPE.exec(s);
          expect(m, s).not.toBeNull();
          expect(BigInt(m?.[2] as string)).toBe(keys[i % keys.length]);
        });
      }),
    );
  });

  it("every query is one equality on chunk_key and nothing else", () => {
    const sql = regionQueries({ cx: -3, cy: 4, band: 0 }, FLOORS).map((q) => toSql(q));
    for (const s of sql) {
      expect(s).toMatch(SHAPE);
      expect(s).not.toMatch(/\b(AND|OR|<|>|BETWEEN|IN)\b/);
    }
    const tablesHit = new Set(sql.map((s) => SHAPE.exec(s)?.[1]));
    expect(tablesHit).toEqual(
      new Set([
        "placed_object",
        "floor_transition",
        "building_area",
        "room_area",
        "actor_location",
      ]),
    );
  });
});
