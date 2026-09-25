// Story 1.10 (AC5) / Story 2.7: `resolveLayers` maps a tuple(+override)
// to the concrete defs rows and packed atlas locations the composite
// pipeline needs -- pure, so this needs no canvas, no Pixi, no `fetch`.
import { describe, expect, it } from "vitest";
import type {
  AccessoryDef,
  AppearanceLayoutDef,
  AtlasRect,
  BodyDef,
  Defs,
  EyesDef,
  HairstyleDef,
  OutfitDef,
} from "../../../../src/defs/types";
import type { AppearanceTuple } from "../../../../src/render/appearance/composite";
import { resolveLayers } from "../../../../src/render/appearance/resolve-layers";

const ADULT_LAYOUT: AppearanceLayoutDef = {
  id: 1,
  key: "adult",
  family: "adult",
  cellWidth: 16,
  cellHeight: 32,
  directions: ["down"],
  rows: [{ animation: "idle", row: 0, framesPerDirection: 1 }],
  acceptedSizes: [{ width: 16, height: 32 }],
};

const KID_LAYOUT: AppearanceLayoutDef = { ...ADULT_LAYOUT, id: 2, key: "kid", family: "kid" };

function atlas(page: number): AtlasRect {
  return { page, x: 0, y: 0, w: 16, h: 32 };
}

const BODY: BodyDef = {
  id: 1,
  key: "body_01",
  family: "adult",
  sheet: "bodies/body_01.png",
  pool: "civilian",
  atlas: atlas(0),
};
const KID_BODY: BodyDef = {
  id: 11,
  key: "kid_body_01",
  family: "kid",
  sheet: "bodies/kid_01.png",
  pool: "civilian",
  atlas: atlas(0),
};
const EYES: EyesDef = {
  id: 1,
  key: "eyes_01",
  family: "adult",
  sheet: "eyes/eyes_01.png",
  pool: "civilian",
  atlas: atlas(1),
};
const OUTFIT: OutfitDef = {
  id: 5,
  key: "outfit_01",
  family: "adult",
  sheet: "outfits/outfit_01.png",
  pool: "civilian",
  hidesHairstyle: false,
  atlas: atlas(2),
};
const HOOD_OUTFIT: OutfitDef = {
  ...OUTFIT,
  id: 6,
  key: "hood_outfit",
  sheet: "outfits/hood.png",
  hidesHairstyle: true,
  atlas: atlas(2),
};
const ROLE_OUTFIT: OutfitDef = {
  ...OUTFIT,
  id: 7,
  key: "role_outfit",
  pool: "role_only",
  sheet: "outfits/role.png",
  atlas: atlas(2),
};
const HAIRSTYLE: HairstyleDef = {
  id: 7,
  key: "hair_01",
  family: "adult",
  sheet: "hairstyles/hair_01.png",
  style: 1,
  color: 1,
  rare: false,
  atlas: atlas(3),
};
const ACCESSORY: AccessoryDef = {
  id: 9,
  key: "beard",
  family: "adult",
  sheet: "accessories/beard.png",
  pool: "civilian",
  slot: "face",
  atlas: atlas(4),
};
const UNIFORM_ACCESSORY: AccessoryDef = {
  id: 42,
  key: "jacket",
  family: "adult",
  sheet: "accessories/jacket.png",
  pool: "role_only",
  slot: "torso",
  atlas: atlas(4),
};

function defsWith(overrides: Partial<Defs> = {}): Defs {
  return {
    defsVersion: "test",
    colliderSubcellsPerCell: 16,
    interactAtMaxReachCells: 2,
    maxFootprintCells: 8,
    maxShelfLifeMinutes: 525_600,
    atlasMaxPagesPerGroup: 2,
    characterCompositePages: 2,
    atlasPages: [],
    objects: [],
    items: [],
    recipes: [],
    professions: [],
    chains: [],
    balance: [],
    bodies: [BODY, KID_BODY],
    eyes: [EYES],
    hairstyles: [HAIRSTYLE],
    outfits: [OUTFIT, HOOD_OUTFIT, ROLE_OUTFIT],
    accessories: [ACCESSORY, UNIFORM_ACCESSORY],
    appearanceLayouts: [ADULT_LAYOUT, KID_LAYOUT],
    uniforms: [],
    tags: [],
    ...overrides,
  };
}

const TUPLE: AppearanceTuple = { body: 1, eyes: 1, outfit: 5, hairstyle: 7, accessory: 9 };

describe("resolveLayers", () => {
  it("resolves the adult layout and every layer's own page/atlas, with no override", () => {
    const resolved = resolveLayers(defsWith(), TUPLE, null);
    expect(resolved.layout).toBe(ADULT_LAYOUT);
    expect(resolved.effectiveOutfit).toBe(OUTFIT);
    expect(resolved.parts).toEqual({
      body: BODY.atlas,
      eyes: EYES.atlas,
      outfit: OUTFIT.atlas,
      hairstyle: HAIRSTYLE.atlas,
      accessory: ACCESSORY.atlas,
      uniformAccessory: null,
    });
  });

  it("picks the kid layout for a kid body", () => {
    const resolved = resolveLayers(defsWith(), { ...TUPLE, body: 11 }, null);
    expect(resolved.layout).toBe(KID_LAYOUT);
  });

  it("resolves `0` hairstyle/accessory to a null part, not a lookup miss", () => {
    const resolved = resolveLayers(defsWith(), { ...TUPLE, hairstyle: 0, accessory: 0 }, null);
    expect(resolved.parts.hairstyle).toBeNull();
    expect(resolved.parts.accessory).toBeNull();
  });

  it("a uniform override replaces the outfit layer and adds a uniformAccessory part", () => {
    const resolved = resolveLayers(defsWith(), TUPLE, { outfit: 7, accessory: 42 });
    expect(resolved.effectiveOutfit).toBe(ROLE_OUTFIT);
    expect(resolved.parts.outfit).toEqual(ROLE_OUTFIT.atlas);
    expect(resolved.parts.accessory).toEqual(ACCESSORY.atlas); // different slot, kept
    expect(resolved.parts.uniformAccessory).toEqual(UNIFORM_ACCESSORY.atlas);
  });

  it("a hidesHairstyle outfit is still reported so the caller can skip drawing hair", () => {
    const resolved = resolveLayers(defsWith(), { ...TUPLE, outfit: 6 }, null);
    expect(resolved.effectiveOutfit.hidesHairstyle).toBe(true);
    // the part is still resolved -- `drawComposite` is the one that
    // skips the layer, not this function
    expect(resolved.parts.hairstyle).toEqual(HAIRSTYLE.atlas);
  });

  it("throws, naming the id, for a tuple.body with no matching def", () => {
    expect(() => resolveLayers(defsWith(), { ...TUPLE, body: 999 }, null)).toThrow(/999/);
  });

  it("throws for a body family with no declared appearance layout", () => {
    const defs = defsWith({ appearanceLayouts: [ADULT_LAYOUT] });
    expect(() => resolveLayers(defs, { ...TUPLE, body: 11 }, null)).toThrow(/kid/);
  });

  it("throws for an effective outfit id with no matching def", () => {
    expect(() => resolveLayers(defsWith(), TUPLE, { outfit: 404 })).toThrow(/404/);
  });
});
