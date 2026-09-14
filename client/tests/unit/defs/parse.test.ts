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
    interact_at_max_reach_cells: 2,
    objects: [{ id: 1, key: "trash_bin", width: 1, height: 1, window: false }],
    items: [
      { id: 1, key: "bottle" },
      { id: 2, key: "recycled_glass" },
    ],
    recipes: [{ id: 1, key: "bottle_recycling", inputs: ["bottle"], outputs: ["recycled_glass"] }],
    professions: [{ id: 1, key: "sanitation_worker" }],
    chains: [{ id: 1, key: "plastic_bottle", links: ["sanitation_worker"] }],
    balance: [{ key: "citizen.bar_decay.rest", value: 10, min: 0, max: 100 }],
    bodies: [],
    eyes: [],
    hairstyles: [],
    outfits: [],
    accessories: [],
    appearance_layouts: [],
    uniforms: [],
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

  it("parses a present interact_at and leaves an absent one undefined (FR148)", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      interact_at: { x0: 0, y0: 16, x1: 16, y1: 32 },
    };
    const defs = parseDefs(payload);
    expect(defs.objects[0]?.interactAt).toEqual({ x0: 0, y0: 16, x1: 16, y1: 32 });
    expect(defs.interactAtMaxReachCells).toBe(2);

    payload.objects = [{ id: 1, key: "trash_bin", width: 1, height: 1, window: false }];
    expect(parseDefs(payload).objects[0]?.interactAt).toBeUndefined();
  });

  it("rejects a zero-area interact_at (FR148)", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      interact_at: { x0: 0, y0: 16, x1: 0, y1: 32 },
    };
    expect(() => parseDefs(payload)).toThrow(/zero or negative area/);
  });

  it("rejects an interact_at reaching further than the declared bound (FR148)", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      // The bound is 2 cells * 16 sub-cells = 32 beyond the footprint.
      interact_at: { x0: -33, y0: 0, x1: 16, y1: 16 },
    };
    expect(() => parseDefs(payload)).toThrow(/reaches further than/);
  });

  it("accepts an interact_at exactly at the declared reach bound (FR148)", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      interact_at: { x0: -32, y0: 0, x1: 16, y1: 16 },
    };
    expect(() => parseDefs(payload)).not.toThrow();
  });

  it("rejects an interact_at lying entirely inside its own collider (FR148)", () => {
    const payload = validPayload();
    (payload.objects as Record<string, unknown>[])[0] = {
      id: 1,
      key: "trash_bin",
      width: 1,
      height: 1,
      window: false,
      collider: { x0: 0, y0: 0, x1: 16, y1: 16 },
      interact_at: { x0: 4, y0: 4, x1: 12, y1: 12 },
    };
    expect(() => parseDefs(payload)).toThrow(/could never be reached/);
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

describe("parseDefs appearance (story 1.10)", () => {
  const LAYOUT = {
    id: 1,
    key: "adult",
    family: "adult",
    cell_width: 16,
    cell_height: 32,
    directions: ["down"],
    rows: [{ animation: "idle", row: 0, frames_per_direction: 1 }],
    accepted_sizes: [{ width: 16, height: 32 }],
  };
  const BODY = { id: 1, key: "body_01", family: "adult", sheet: "x/body.png" };
  const EYES = { id: 1, key: "eyes_01", family: "adult", sheet: "x/eyes.png" };
  const OUTFIT = {
    id: 1,
    key: "outfit_01",
    family: "adult",
    sheet: "x/outfit.png",
    pool: "civilian",
    hides_hairstyle: false,
  };
  const HAIRSTYLE = {
    id: 1,
    key: "hair_01",
    family: "adult",
    sheet: "x/hair.png",
    style: 1,
    color: 1,
    rare: false,
  };
  const ROLE_ACCESSORY = {
    id: 1,
    key: "jacket",
    family: "adult",
    sheet: "x/jacket.png",
    pool: "role_only",
    slot: "torso",
  };
  const CIVILIAN_ACCESSORY = {
    id: 2,
    key: "backpack",
    family: "adult",
    sheet: "x/backpack.png",
    pool: "civilian",
    slot: "back",
  };

  function appearancePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...validPayload(),
      appearance_layouts: [LAYOUT],
      bodies: [BODY],
      eyes: [EYES],
      outfits: [OUTFIT],
      hairstyles: [HAIRSTYLE],
      accessories: [ROLE_ACCESSORY, CIVILIAN_ACCESSORY],
      uniforms: [],
      ...overrides,
    };
  }

  it("parses a full, self-consistent appearance tree", () => {
    const defs = parseDefs(appearancePayload());
    expect(defs.bodies).toEqual([BODY]);
    expect(defs.appearanceLayouts[0]?.family).toBe("adult");
  });

  it("rejects an unknown family value", () => {
    const payload = appearancePayload({ bodies: [{ ...BODY, family: "teen" }] });
    expect(() => parseDefs(payload)).toThrow(/expected 'adult' or 'kid'/);
  });

  it("rejects an unknown pool value", () => {
    const payload = appearancePayload({ outfits: [{ ...OUTFIT, pool: "bogus" }] });
    expect(() => parseDefs(payload)).toThrow(/expected 'civilian', 'role_only' or 'costume'/);
  });

  for (const kind of [
    "bodies",
    "eyes",
    "hairstyles",
    "outfits",
    "accessories",
    "appearance_layouts",
  ] as const) {
    it(`rejects id 0 for '${kind}'`, () => {
      const template: Record<string, Record<string, unknown>> = {
        bodies: BODY,
        eyes: EYES,
        hairstyles: HAIRSTYLE,
        outfits: OUTFIT,
        accessories: ROLE_ACCESSORY,
        appearance_layouts: LAYOUT,
      };
      const payload = appearancePayload({ [kind]: [{ ...template[kind], id: 0 }] });
      expect(() => parseDefs(payload)).toThrow(/declares id 0/);
    });
  }

  it("rejects duplicate ids within one appearance kind", () => {
    const payload = appearancePayload({ bodies: [BODY, { ...BODY, key: "body_02" }] });
    expect(() => parseDefs(payload)).toThrow(/duplicate body id/);
  });

  it("rejects duplicate keys within one appearance kind even with distinct ids", () => {
    const payload = appearancePayload({ bodies: [BODY, { ...BODY, id: 2 }] });
    expect(() => parseDefs(payload)).toThrow(/duplicate body key/);
  });

  it("rejects a part naming a family with no matching appearance_layout", () => {
    const payload = appearancePayload({ bodies: [{ ...BODY, family: "kid" }] });
    expect(() => parseDefs(payload)).toThrow(/no appearance_layout entry declares that family/);
  });

  it("rejects two appearance_layout entries for the same family", () => {
    const payload = appearancePayload({
      appearance_layouts: [LAYOUT, { ...LAYOUT, id: 2, key: "adult2" }],
    });
    expect(() => parseDefs(payload)).toThrow(/already covered/);
  });

  it("uniform: accepts a real profession and a role_only adult accessory", () => {
    const payload = appearancePayload({
      uniforms: [{ id: 1, key: "u1", profession: "sanitation_worker", accessory: "jacket" }],
    });
    expect(() => parseDefs(payload)).not.toThrow();
  });

  it("uniform: rejects an unknown profession", () => {
    const payload = appearancePayload({
      uniforms: [{ id: 1, key: "u1", profession: "ghost", accessory: "jacket" }],
    });
    expect(() => parseDefs(payload)).toThrow(/names unknown profession/);
  });

  it("uniform: rejects a duplicate profession", () => {
    const payload = appearancePayload({
      uniforms: [
        { id: 1, key: "u1", profession: "sanitation_worker", accessory: "jacket" },
        { id: 2, key: "u2", profession: "sanitation_worker", accessory: "jacket" },
      ],
    });
    expect(() => parseDefs(payload)).toThrow(/exactly one uniform per profession/);
  });

  it("uniform: rejects overriding neither outfit nor accessory", () => {
    const payload = appearancePayload({
      uniforms: [{ id: 1, key: "u1", profession: "sanitation_worker" }],
    });
    expect(() => parseDefs(payload)).toThrow(/overrides neither/);
  });

  it("uniform: rejects an unknown outfit reference", () => {
    const payload = appearancePayload({
      uniforms: [{ id: 1, key: "u1", profession: "sanitation_worker", outfit: "ghost" }],
    });
    expect(() => parseDefs(payload)).toThrow(/names unknown outfit/);
  });

  it("uniform: rejects an unknown accessory reference", () => {
    const payload = appearancePayload({
      uniforms: [{ id: 1, key: "u1", profession: "sanitation_worker", accessory: "ghost" }],
    });
    expect(() => parseDefs(payload)).toThrow(/names unknown accessory/);
  });

  it("uniform: rejects a civilian-pool accessory", () => {
    const payload = appearancePayload({
      uniforms: [{ id: 1, key: "u1", profession: "sanitation_worker", accessory: "backpack" }],
    });
    expect(() => parseDefs(payload)).toThrow(/not an adult role_only accessory/);
  });

  it("uniform: rejects a civilian-pool outfit", () => {
    const payload = appearancePayload({
      uniforms: [{ id: 1, key: "u1", profession: "sanitation_worker", outfit: "outfit_01" }],
    });
    expect(() => parseDefs(payload)).toThrow(/not an adult role_only outfit/);
  });

  it("uniform: accepts a role_only outfit override", () => {
    const roleOutfit = { ...OUTFIT, id: 2, key: "role_outfit", pool: "role_only" };
    const payload = appearancePayload({
      outfits: [OUTFIT, roleOutfit],
      uniforms: [{ id: 1, key: "u1", profession: "sanitation_worker", outfit: "role_outfit" }],
    });
    expect(() => parseDefs(payload)).not.toThrow();
  });

  it("rejects an unknown field on an appearance part", () => {
    const payload = appearancePayload({ bodies: [{ ...BODY, bogus: 1 }] });
    expect(() => parseDefs(payload)).toThrow(/unknown field/);
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
        "object trash_bin id=1 height=1 width=1 collider=none interact_at=none window=false",
        "profession sanitation_worker id=1",
        "recipe bottle_recycling id=1 inputs=[bottle] outputs=[recycled_glass]",
        "",
      ].join("\n"),
    );
  });
});
