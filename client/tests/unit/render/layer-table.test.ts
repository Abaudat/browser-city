import { describe, expect, it } from "vitest";
import {
  DEPRECATED_LAYER_CODES,
  FIRST_POOL_RANK,
  LAYER_TABLE,
  layerCodeByName,
  passOfLayer,
} from "../../../src/render/layer-table";

describe("LAYER_TABLE", () => {
  it("has exactly one row per sim::codes::layer entry, in the same order", () => {
    expect(LAYER_TABLE.map((r) => r.name)).toEqual([
      "ground",
      "overhead",
      "furniture",
      "objects",
      "walls",
      "wall_decals",
      "characters",
      "ground_objects",
    ]);
  });

  it("marks exactly the codes sim::codes::layer::DEPRECATED_CODES marks", () => {
    expect(DEPRECATED_LAYER_CODES.has(1)).toBe(true);
    expect(DEPRECATED_LAYER_CODES.size).toBe(1);
  });
});

describe("layerCodeByName", () => {
  it("resolves a live layer name to its code", () => {
    expect(layerCodeByName("furniture")).toBe(2);
    expect(layerCodeByName("characters")).toBe(6);
  });

  it("throws for a deprecated name", () => {
    expect(() => layerCodeByName("overhead")).toThrow();
  });

  it("throws for an unknown name", () => {
    expect(() => layerCodeByName("not-a-real-layer")).toThrow();
  });
});

describe("passOfLayer", () => {
  it("routes ground, ground_objects and every pool layer to their pass", () => {
    expect(passOfLayer(layerCodeByName("ground"))).toBe("ground");
    expect(passOfLayer(layerCodeByName("ground_objects"))).toBe("groundObjects");
    for (const name of ["furniture", "objects", "walls", "wall_decals", "characters"]) {
      expect(passOfLayer(layerCodeByName(name))).toBe("pool");
    }
  });

  it("throws for a deprecated or unknown code", () => {
    expect(() => passOfLayer(1)).toThrow();
    expect(() => passOfLayer(999)).toThrow();
  });
});

describe("passOfLayer is rank-driven", () => {
  it("every live row resolves by its rank: 0 ground, below FIRST_POOL_RANK ground objects, else pool", () => {
    for (const row of LAYER_TABLE.filter((r) => !r.deprecated)) {
      const expected =
        row.rank >= FIRST_POOL_RANK ? "pool" : row.rank === 0 ? "ground" : "groundObjects";
      expect(passOfLayer(row.code), row.name).toBe(expected);
    }
  });
});
