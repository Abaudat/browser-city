// Layer order body -> eyes -> outfit -> hairstyle -> accessory ->
// uniformAccessory, `0` skipped, a uniform override applying an
// *additional* accessory layer (never simply replacing the civilian
// one, FR61), and the frog/tiger pyjama's `hidesHairstyle` suppressing
// the hairstyle layer even when the citizen has one. Tested against a
// fake canvas-like context (records calls) so this needs no real canvas
// or Pixi.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDefs } from "../../../../src/defs/parse";
import type {
  AccessoryDef,
  AppearanceLayoutDef,
  Defs,
  OutfitDef,
} from "../../../../src/defs/types";
import {
  type AppearanceTuple,
  appearanceCacheKey,
  drawComposite,
  effectiveLayers,
  resolveUniform,
} from "../../../../src/render/appearance/composite";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

function committedDefs(): Defs {
  return parseDefs(
    JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")) as unknown,
  );
}

// One direction, one frame -- exactly one composite cell, so each test
// below can assert the layer draw order directly without also tracking
// which of several cells a call belongs to (frame-rect.test.ts already
// covers the multi-cell packing math on its own).
const LAYOUT: AppearanceLayoutDef = {
  id: 1,
  key: "adult",
  family: "adult",
  cellWidth: 16,
  cellHeight: 32,
  directions: ["down"],
  rows: [{ animation: "idle", row: 1, framesPerDirection: 1 }],
  acceptedSizes: [{ width: 16, height: 32 }],
};

const TUPLE: AppearanceTuple = { body: 1, eyes: 1, outfit: 5, hairstyle: 7, accessory: 9 };

function outfitDef(overrides: Partial<OutfitDef> = {}): OutfitDef {
  return {
    id: 5,
    key: "outfit_test",
    family: "adult",
    sheet: "x.png",
    pool: "civilian",
    hidesHairstyle: false,
    ...overrides,
  };
}

function accessoryDef(overrides: Partial<AccessoryDef> = {}): AccessoryDef {
  return {
    id: 9,
    key: "beard",
    family: "adult",
    sheet: "beard.png",
    pool: "civilian",
    slot: "face",
    ...overrides,
  };
}

describe("effectiveLayers", () => {
  it("uses the tuple's own civilian outfit/accessory when there is no override", () => {
    expect(effectiveLayers(TUPLE, null, [])).toEqual({
      outfit: 5,
      civilianAccessory: 9,
      uniformAccessory: 0,
    });
  });

  it("an outfit override always replaces the outfit layer", () => {
    expect(effectiveLayers(TUPLE, { outfit: 3 }, [])).toEqual({
      outfit: 3,
      civilianAccessory: 9,
      uniformAccessory: 0,
    });
  });

  it("a different-slot uniform accessory draws alongside the civilian one, never replacing it (FR61)", () => {
    const accessories = [
      accessoryDef({ id: 9, slot: "face" }), // the citizen's own beard
      accessoryDef({ id: 42, key: "jacket", slot: "torso" }), // the uniform's jacket
    ];
    expect(effectiveLayers(TUPLE, { accessory: 42 }, accessories)).toEqual({
      outfit: 5,
      civilianAccessory: 9,
      uniformAccessory: 42,
    });
  });

  it("a same-slot uniform accessory removes the civilian one (a helmet removes a beanie)", () => {
    const accessories = [
      accessoryDef({ id: 9, key: "beanie", slot: "head" }),
      accessoryDef({ id: 42, key: "helmet", slot: "head" }),
    ];
    expect(effectiveLayers(TUPLE, { accessory: 42 }, accessories)).toEqual({
      outfit: 5,
      civilianAccessory: 0,
      uniformAccessory: 42,
    });
  });

  it("a citizen with no civilian accessory (0) is unaffected by the slot check", () => {
    const bare: AppearanceTuple = { ...TUPLE, accessory: 0 };
    const accessories = [accessoryDef({ id: 42, key: "jacket", slot: "torso" })];
    expect(effectiveLayers(bare, { accessory: 42 }, accessories)).toEqual({
      outfit: 5,
      civilianAccessory: 0,
      uniformAccessory: 42,
    });
  });

  it("a bearded citizen keeps his beard under a hi-vis jacket uniform (FR61)", () => {
    const bearded: AppearanceTuple = { ...TUPLE, accessory: 9 }; // civilian beard, face slot
    const accessories = [
      accessoryDef({ id: 9, key: "beard", slot: "face" }),
      accessoryDef({ id: 42, key: "worker_jacket", slot: "torso" }),
    ];
    const layers = effectiveLayers(bearded, { accessory: 42 }, accessories);
    expect(layers.civilianAccessory).toBe(9);
    expect(layers.uniformAccessory).toBe(42);
  });

  // A civilian accessory is only ever removed by a uniform override that
  // declares the *same* slot (a medical mask removing a beard, both
  // face) -- never by one on a different slot (a policeman hat, head,
  // never touches a face-slot beard), over every civilian/uniform
  // accessory pair possible in the real committed catalogue, never just
  // the one hand-picked case above.
  it("a civilian accessory is only ever removed by a uniform override on the same slot", () => {
    const defs = committedDefs();
    const civilianAccessories = defs.accessories.filter((a) => a.pool === "civilian");
    const uniformAccessories = defs.accessories.filter((a) => a.pool === "role_only");
    for (const civilian of civilianAccessories) {
      for (const uniform of uniformAccessories) {
        const tuple: AppearanceTuple = { ...TUPLE, accessory: civilian.id };
        const layers = effectiveLayers(tuple, { accessory: uniform.id }, defs.accessories);
        if (uniform.slot === civilian.slot) {
          expect(layers.civilianAccessory).toBe(0);
        } else {
          expect(layers.civilianAccessory).toBe(civilian.id);
        }
      }
    }
  });
});

describe("appearanceCacheKey", () => {
  it("is the same for the same tuple and override", () => {
    expect(appearanceCacheKey(TUPLE, { accessory: 42 })).toBe(
      appearanceCacheKey({ ...TUPLE }, { accessory: 42 }),
    );
  });

  it("differs for a civilian vs a uniformed version of the same tuple", () => {
    expect(appearanceCacheKey(TUPLE, null)).not.toBe(appearanceCacheKey(TUPLE, { accessory: 42 }));
  });

  it("differs for two different tuples with no override", () => {
    expect(appearanceCacheKey(TUPLE, null)).not.toBe(
      appearanceCacheKey({ ...TUPLE, hairstyle: 3 }, null),
    );
  });
});

describe("drawComposite", () => {
  it("draws body, eyes, outfit, hairstyle, accessory, uniformAccessory in that order, skipping any 0 layer", () => {
    const order: string[] = [];
    const images = {
      body: { name: "body" },
      eyes: { name: "eyes" },
      outfit: { name: "outfit" },
      hairstyle: { name: "hairstyle" },
      accessory: null, // e.g. tuple.accessory === 0
      uniformAccessory: { name: "uniformAccessory" },
    };
    const spyCtx = {
      imageSmoothingEnabled: true,
      drawImage: (image: { name: string }) => order.push(image.name),
    };

    drawComposite(spyCtx, LAYOUT, images, outfitDef());

    expect(order).toEqual(["body", "eyes", "outfit", "hairstyle", "uniformAccessory"]);
  });

  it("draws the civilian accessory before the uniform accessory, so the uniform sits on top", () => {
    const order: string[] = [];
    const images = {
      body: null,
      eyes: null,
      outfit: null,
      hairstyle: null,
      accessory: { name: "beard" },
      uniformAccessory: { name: "jacket" },
    };
    const spyCtx = {
      imageSmoothingEnabled: true,
      drawImage: (image: { name: string }) => order.push(image.name),
    };

    drawComposite(spyCtx, LAYOUT, images, outfitDef());

    expect(order).toEqual(["beard", "jacket"]);
  });

  it("skips the hairstyle layer entirely when the effective outfit hides it, even if the citizen has hair", () => {
    const order: string[] = [];
    const images = {
      body: { name: "body" },
      eyes: { name: "eyes" },
      outfit: { name: "outfit" },
      hairstyle: { name: "hairstyle" },
      accessory: { name: "accessory" },
      uniformAccessory: null,
    };
    const spyCtx = {
      imageSmoothingEnabled: true,
      drawImage: (image: { name: string }) => order.push(image.name),
    };

    drawComposite(spyCtx, LAYOUT, images, outfitDef({ hidesHairstyle: true }));

    expect(order).toEqual(["body", "eyes", "outfit", "accessory"]);
  });

  it("sets nearest-neighbour sampling (no smoothing) before drawing anything", () => {
    const calls: boolean[] = [];
    const spyCtx = {
      get imageSmoothingEnabled() {
        return false;
      },
      set imageSmoothingEnabled(v: boolean) {
        calls.push(v);
      },
      drawImage: () => {},
    };
    drawComposite(
      spyCtx,
      LAYOUT,
      {
        body: null,
        eyes: null,
        outfit: null,
        hairstyle: null,
        accessory: null,
        uniformAccessory: null,
      },
      outfitDef(),
    );
    expect(calls).toContain(false);
  });
});

function defsWith(overrides: Partial<Defs> = {}): Defs {
  return {
    defsVersion: "test",
    colliderSubcellsPerCell: 16,
    interactAtMaxReachCells: 2,
    maxFootprintCells: 8,
    atlasMaxPagesPerGroup: 2,
    atlasPages: [],
    objects: [],
    items: [],
    recipes: [],
    professions: [],
    chains: [],
    balance: [],
    bodies: [],
    eyes: [],
    hairstyles: [],
    outfits: [],
    accessories: [],
    appearanceLayouts: [],
    uniforms: [],
    tags: [],
    ...overrides,
  };
}

describe("resolveUniform", () => {
  it("resolves a profession's declared outfit and accessory overrides by key to id", () => {
    const defs = defsWith({
      outfits: [outfitDef({ id: 3, key: "role_outfit", pool: "role_only" })],
      accessories: [accessoryDef({ id: 42, key: "jacket", pool: "role_only", slot: "torso" })],
      uniforms: [
        {
          id: 1,
          key: "sanitation_worker_uniform",
          profession: "sanitation_worker",
          outfit: "role_outfit",
          accessory: "jacket",
        },
      ],
    });

    expect(resolveUniform(defs, "sanitation_worker")).toEqual({ outfit: 3, accessory: 42 });
  });

  it("omits a field the uniform does not override", () => {
    const defs = defsWith({
      accessories: [accessoryDef({ id: 42, key: "jacket", pool: "role_only", slot: "torso" })],
      uniforms: [{ id: 1, key: "u", profession: "sanitation_worker", accessory: "jacket" }],
    });

    expect(resolveUniform(defs, "sanitation_worker")).toEqual({ accessory: 42 });
  });

  it("is null for a profession with no declared uniform", () => {
    expect(resolveUniform(defsWith(), "no_such_profession")).toBeNull();
  });

  // The trace-matrix-registered property (docs/trace-matrix.md,
  // scripts/ci/check-trace-matrix.sh): against the real committed
  // `client/public/defs/defs.json`, resolving any profession's uniform
  // override always yields that profession's own declared role_only,
  // adult outfit/accessory by id -- `tools/defs-build` already proved
  // this once at build time; this proves the client's own read agrees.
  it("inv_outfit_follows_occupation", () => {
    const defs = committedDefs();
    for (const profession of defs.professions) {
      const uniform = resolveUniform(defs, profession.key);
      if (!uniform) continue;
      if (uniform.outfit !== undefined) {
        const def = defs.outfits.find((o) => o.id === uniform.outfit);
        expect(def).toBeDefined();
        expect(def?.pool).toBe("role_only");
        expect(def?.family).toBe("adult");
      }
      if (uniform.accessory !== undefined) {
        const def = defs.accessories.find((a) => a.id === uniform.accessory);
        expect(def).toBeDefined();
        expect(def?.pool).toBe("role_only");
        expect(def?.family).toBe("adult");
      }
    }
  });
});
