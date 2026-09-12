import { describe, expect, it } from "vitest";
import {
  DEPRECATED_LAYER_CODES,
  LAYER_TABLE,
  layerCodeByName,
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
