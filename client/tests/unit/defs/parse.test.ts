import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalDump, DefsParseError, parseDefs } from "../../../src/defs/parse";
import type { Defs } from "../../../src/defs/types";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function validPayload(): Record<string, unknown> {
  return {
    generated_by: "tools/defs-build -- do not edit by hand",
    defs_version: "abc123",
    collider_subcells_per_cell: 16,
    objects: [{ id: 1, key: "trash_bin", width: 1, height: 1, window: false }],
    items: [
      { id: 1, key: "bottle" },
      { id: 2, key: "recycled_glass" },
    ],
    recipes: [{ id: 1, key: "bottle_recycling", inputs: ["bottle"], outputs: ["recycled_glass"] }],
    professions: [{ id: 1, key: "sanitation_worker" }],
    chains: [{ id: 1, key: "plastic_bottle", links: ["sanitation_worker"] }],
    balance: [{ key: "citizen.bar_decay.rest", value: 10, min: 0, max: 100 }],
  };
}

describe("parseDefs", () => {
  it("parses a well-formed document into the plain Defs shape", () => {
    const defs = parseDefs(validPayload());
    expect(defs.defsVersion).toBe("abc123");
    expect(defs.objects).toEqual([{ id: 1, key: "trash_bin", width: 1, height: 1, window: false }]);
    expect(defs.recipes[0]?.inputs).toEqual(["bottle"]);
  });

  it("rejects a non-object document", () => {
    expect(() => parseDefs("nope")).toThrow(DefsParseError);
    expect(() => parseDefs(null)).toThrow(DefsParseError);
    expect(() => parseDefs([])).toThrow(DefsParseError);
  });

  it("rejects an unknown top-level field", () => {
    const payload = { ...validPayload(), bogus: 1 };
    expect(() => parseDefs(payload)).toThrow(/unknown field 'bogus'/);
  });

  it("rejects an unknown field on one entry", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: 1, key: "bottle", bogus: 2 };
    expect(() => parseDefs(payload)).toThrow(/unknown field 'bogus'/);
  });

  it("rejects a missing required field", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected a number/);
  });

  it("rejects a wrong value type", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: "nope", key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected a number/);
  });

  it("rejects a non-integer id, never accepting what the module could not have produced", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: 1.5, key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected an integer in \[0, 2\^32\)/);
  });

  it("rejects a negative id", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: -1, key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected an integer in \[0, 2\^32\)/);
  });

  it("rejects an id at or above 2^32", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: 2 ** 32, key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected an integer in \[0, 2\^32\)/);
  });

  it("rejects a non-integer balance value", () => {
    const payload = validPayload();
    payload.balance = [{ key: "a", value: 1.5, min: 0, max: 10 }];
    expect(() => parseDefs(payload)).toThrow(/expected an integer/);
  });

  it("rejects a duplicate id within one kind", () => {
    const payload = validPayload();
    payload.items = [
      { id: 1, key: "bottle" },
      { id: 1, key: "recycled_glass" },
    ];
    expect(() => parseDefs(payload)).toThrow(/duplicate item id 1/);
  });

  it("rejects a duplicate key within one kind", () => {
    const payload = validPayload();
    payload.items = [
      { id: 1, key: "bottle" },
      { id: 2, key: "bottle" },
    ];
    expect(() => parseDefs(payload)).toThrow(/duplicate item key 'bottle'/);
  });

  it("rejects a recipe naming an unknown item in inputs", () => {
    const payload = validPayload();
    payload.recipes = [{ id: 1, key: "r", inputs: ["nope"], outputs: [] }];
    expect(() => parseDefs(payload)).toThrow(/unknown item 'nope' in inputs/);
  });

  it("rejects a recipe naming an unknown item in outputs", () => {
    const payload = validPayload();
    payload.recipes = [{ id: 1, key: "r", inputs: [], outputs: ["nope"] }];
    expect(() => parseDefs(payload)).toThrow(/unknown item 'nope' in outputs/);
  });

  it("rejects a chain naming an unknown profession", () => {
    const payload = validPayload();
    payload.chains = [{ id: 1, key: "c", links: ["nope"] }];
    expect(() => parseDefs(payload)).toThrow(/unknown profession 'nope'/);
  });

  it("rejects an out-of-range balance value", () => {
    const payload = validPayload();
    payload.balance = [{ key: "a", value: 999, min: 0, max: 10 }];
    expect(() => parseDefs(payload)).toThrow(/out of its own declared range/);
  });

  it("accepts a balance value at the boundary", () => {
    const payload = validPayload();
    payload.balance = [{ key: "a", value: 10, min: 0, max: 10 }];
    expect(() => parseDefs(payload)).not.toThrow();
  });

  it("parses a present collider and leaves an absent one undefined", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      collider: { x0: 4, y0: 4, x1: 12, y1: 12 },
    };
    const defs = parseDefs(payload);
    expect(defs.objects[0]?.collider).toEqual({ x0: 4, y0: 4, x1: 12, y1: 12 });

    payload.objects = [{ id: 1, key: "trash_bin", width: 1, height: 1, window: false }];
    expect(parseDefs(payload).objects[0]?.collider).toBeUndefined();
  });

  it("rejects a non-integer collider bound", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      collider: { x0: 4.5, y0: 4, x1: 12, y1: 12 },
    };
    expect(() => parseDefs(payload)).toThrow(/expected an integer in \[-2\^31, 2\^31\)/);
  });

  it("treats an explicit null collider the same as an absent one", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      collider: null,
    };
    expect(parseDefs(payload).objects[0]?.collider).toBeUndefined();
  });

  it("rejects a zero-area collider (FR128)", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      collider: { x0: 5, y0: 5, x1: 5, y1: 9 },
    };
    expect(() => parseDefs(payload)).toThrow(/zero or negative area/);
  });

  it("rejects a collider outside its own footprint (FR128)", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      collider: { x0: 0, y0: 0, x1: 20, y1: 8 },
    };
    expect(() => parseDefs(payload)).toThrow(/does not fit inside its footprint/);
  });

  it("accepts a collider flush with the footprint edge (FR128)", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      collider: { x0: 0, y0: 0, x1: 16, y1: 16 },
    };
    expect(() => parseDefs(payload)).not.toThrow();
  });

  it("rejects a missing window field", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
    };
    expect(() => parseDefs(payload)).toThrow(/expected a boolean/);
  });

  it("rejects a non-boolean window field", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: "nope",
    };
    expect(() => parseDefs(payload)).toThrow(/expected a boolean/);
  });

  it("accepts window: true", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "shop_window",
      width: 1,
      height: 1,
      window: true,
    };
    const defs = parseDefs(payload);
    expect(defs.objects[0]?.window).toBe(true);
  });

  it("inv_collider_within_footprint", () => {
    // Real, committed data: every object's own collider (if any) is
    // contained in its own footprint -- checked independently of
    // `parseDefs`'s own enforcement of the same rule, against real
    // `defs/objects` content (Quentin's direction).
    const defsJson = JSON.parse(
      readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8"),
    ) as {
      collider_subcells_per_cell: number;
      objects: readonly {
        width: number;
        height: number;
        collider: { x0: number; y0: number; x1: number; y1: number } | null;
      }[];
    };
    const perCell = defsJson.collider_subcells_per_cell;
    const withColliders = defsJson.objects.filter((o) => o.collider !== null);
    expect(withColliders.length).toBeGreaterThan(0);
    for (const o of withColliders) {
      const c = o.collider as { x0: number; y0: number; x1: number; y1: number };
      expect(c.x1).toBeGreaterThan(c.x0);
      expect(c.y1).toBeGreaterThan(c.y0);
      expect(c.x0).toBeGreaterThanOrEqual(0);
      expect(c.y0).toBeGreaterThanOrEqual(0);
      expect(c.x1).toBeLessThanOrEqual(o.width * perCell);
      expect(c.y1).toBeLessThanOrEqual(o.height * perCell);
    }

    // Property: for any footprint and any collider rect, `parseDefs`
    // accepts it exactly when it is contained (positive area, inside
    // `width*16 x height*16`) and rejects it otherwise.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: -20, max: 140 }),
        fc.integer({ min: -20, max: 140 }),
        fc.integer({ min: -20, max: 140 }),
        fc.integer({ min: -20, max: 140 }),
        (width, height, x0, y0, x1, y1) => {
          const payload = validPayload();
          payload.objects = [
            { id: 1, key: "x", width, height, window: false, collider: { x0, y0, x1, y1 } },
          ];
          const maxX = width * 16;
          const maxY = height * 16;
          const contained = x1 > x0 && y1 > y0 && x0 >= 0 && y0 >= 0 && x1 <= maxX && y1 <= maxY;
          if (contained) {
            expect(() => parseDefs(payload)).not.toThrow();
          } else {
            expect(() => parseDefs(payload)).toThrow();
          }
        },
      ),
    );
  });
});

describe("canonicalDump", () => {
  it("sorts every kind by key and formats every field in a fixed order", () => {
    const defs: Defs = parseDefs(validPayload());
    const dump = canonicalDump(defs);
    expect(dump).toBe(
      [
        "balance citizen.bar_decay.rest value=10 min=0 max=100",
        "chain plastic_bottle id=1 links=[sanitation_worker]",
        "item bottle id=1",
        "item recycled_glass id=2",
        "object trash_bin id=1 height=1 width=1 collider=none window=false",
        "profession sanitation_worker id=1",
        "recipe bottle_recycling id=1 inputs=[bottle] outputs=[recycled_glass]",
        "",
      ].join("\n"),
    );
  });
});
