// Story 1.10 (AC5): `resolveLayers` maps a tuple(+override) to the
// concrete defs rows and sheet paths the composite pipeline needs --
// pure, so this needs no canvas, no Pixi, no `fetch`.
import { describe, expect, it } from "vitest";
import type {
  AccessoryDef,
  AppearanceLayoutDef,
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

const BODY: BodyDef = {
  id: 1,
  key: "body_01",
  family: "adult",
  sheet: "bodies/body_01.png",
  pool: "civilian",
};
const KID_BODY: BodyDef = {
  id: 11,
  key: "kid_body_01",
  family: "kid",
  sheet: "bodies/kid_01.png",
  pool: "civilian",
};
const EYES: EyesDef = {
  id: 1,
  key: "eyes_01",
  family: "adult",
  sheet: "eyes/eyes_01.png",
  pool: "civilian",
};
const OUTFIT: OutfitDef = {
  id: 5,
  key: "outfit_01",
  family: "adult",
  sheet: "outfits/outfit_01.png",
  pool: "civilian",
  hidesHairstyle: false,
};
const HOOD_OUTFIT: OutfitDef = {
  ...OUTFIT,
  id: 6,
  key: "hood_outfit",
  sheet: "outfits/hood.png",
  hidesHairstyle: true,
};
const ROLE_OUTFIT: OutfitDef = {
  ...OUTFIT,
  id: 7,
  key: "role_outfit",
  pool: "role_only",
  sheet: "outfits/role.png",
};
const HAIRSTYLE: HairstyleDef = {
  id: 7,
  key: "hair_01",
  family: "adult",
  sheet: "hairstyles/hair_01.png",
  style: 1,
  color: 1,
  rare: false,
};
const ACCESSORY: AccessoryDef = {
  id: 9,
  key: "beard",
  family: "adult",
  sheet: "accessories/beard.png",
  pool: "civilian",
  slot: "face",
};
const UNIFORM_ACCESSORY: AccessoryDef = {
  id: 42,
  key: "jacket",
  family: "adult",
  sheet: "accessories/jacket.png",
  pool: "role_only",
  slot: "torso",
};

function defsWith(overrides: Partial<Defs> = {}): Defs {
  return {
    defsVersion: "test",
    colliderSubcellsPerCell: 16,
    interactAtMaxReachCells: 2,
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
    ...overrides,
  };
}

const TUPLE: AppearanceTuple = { body: 1, eyes: 1, outfit: 5, hairstyle: 7, accessory: 9 };

describe("resolveLayers", () => {
  it("resolves the adult layout and every layer's own sheet, with no override", () => {
    const resolved = resolveLayers(defsWith(), TUPLE, null);
    expect(resolved.layout).toBe(ADULT_LAYOUT);
    expect(resolved.effectiveOutfit).toBe(OUTFIT);
    expect(resolved.sheets).toEqual({
      body: "bodies/body_01.png",
      eyes: "eyes/eyes_01.png",
      outfit: "outfits/outfit_01.png",
      hairstyle: "hairstyles/hair_01.png",
      accessory: "accessories/beard.png",
      uniformAccessory: null,
    });
  });

  it("picks the kid layout for a kid body", () => {
    const resolved = resolveLayers(defsWith(), { ...TUPLE, body: 11 }, null);
    expect(resolved.layout).toBe(KID_LAYOUT);
  });

  it("resolves `0` hairstyle/accessory to a null sheet, not a lookup miss", () => {
    const resolved = resolveLayers(defsWith(), { ...TUPLE, hairstyle: 0, accessory: 0 }, null);
    expect(resolved.sheets.hairstyle).toBeNull();
    expect(resolved.sheets.accessory).toBeNull();
  });

  it("a uniform override replaces the outfit layer and adds a uniformAccessory sheet", () => {
    const resolved = resolveLayers(defsWith(), TUPLE, { outfit: 7, accessory: 42 });
    expect(resolved.effectiveOutfit).toBe(ROLE_OUTFIT);
    expect(resolved.sheets.outfit).toBe("outfits/role.png");
    expect(resolved.sheets.accessory).toBe("accessories/beard.png"); // different slot, kept
    expect(resolved.sheets.uniformAccessory).toBe("accessories/jacket.png");
  });

  it("a hidesHairstyle outfit is still reported so the caller can skip drawing hair", () => {
    const resolved = resolveLayers(defsWith(), { ...TUPLE, outfit: 6 }, null);
    expect(resolved.effectiveOutfit.hidesHairstyle).toBe(true);
    // the sheet is still resolved -- `drawComposite` is the one that
    // skips the layer, not this function
    expect(resolved.sheets.hairstyle).toBe("hairstyles/hair_01.png");
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
