// Story 1.10 (Artie's direction): layer order body -> eyes -> outfit ->
// hairstyle -> accessory, `0` skipped, a uniform override replacing the
// outfit and/or accessory layer, and the frog/tiger pyjama's
// `hidesHairstyle` suppressing the hairstyle layer even when the citizen
// has one. Tested against a fake canvas-like context (records calls) so
// this needs no real canvas or Pixi.
import { describe, expect, it } from "vitest";
import type { AppearanceLayoutDef, OutfitDef } from "../../../../src/defs/types";
import {
  type AppearanceTuple,
  appearanceCacheKey,
  drawComposite,
  effectiveOutfitAndAccessory,
} from "../../../../src/render/appearance/composite";

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

interface DrawCall {
  readonly layer: string;
  readonly image: unknown;
}

class FakeContext {
  readonly calls: DrawCall[] = [];
  imageSmoothingEnabled = true;
  drawImage(_image: unknown, ..._rest: number[]): void {
    // Recorded by the caller via `recordingImages` below -- this fake
    // only needs to prove *that* a draw happened and in what order.
  }
}

describe("effectiveOutfitAndAccessory", () => {
  it("uses the tuple's own civilian outfit/accessory when there is no override", () => {
    expect(effectiveOutfitAndAccessory(TUPLE, null)).toEqual({ outfit: 5, accessory: 9 });
  });

  it("a uniform override replaces only the layer it names", () => {
    expect(effectiveOutfitAndAccessory(TUPLE, { accessory: 42 })).toEqual({
      outfit: 5,
      accessory: 42,
    });
    expect(effectiveOutfitAndAccessory(TUPLE, { outfit: 3 })).toEqual({
      outfit: 3,
      accessory: 9,
    });
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
  it("draws body, eyes, outfit, hairstyle, accessory in that order, skipping any 0 layer", () => {
    const ctx = new FakeContext();
    const order: string[] = [];
    const images = {
      body: { name: "body" },
      eyes: { name: "eyes" },
      outfit: { name: "outfit" },
      hairstyle: { name: "hairstyle" },
      accessory: null, // e.g. tuple.accessory === 0
    };
    const spyCtx = {
      ...ctx,
      drawImage: (image: { name: string }) => order.push(image.name),
    };

    drawComposite(spyCtx, LAYOUT, images, outfitDef());

    expect(order).toEqual(["body", "eyes", "outfit", "hairstyle"]);
  });

  it("skips the hairstyle layer entirely when the effective outfit hides it, even if the citizen has hair", () => {
    const order: string[] = [];
    const images = {
      body: { name: "body" },
      eyes: { name: "eyes" },
      outfit: { name: "outfit" },
      hairstyle: { name: "hairstyle" },
      accessory: { name: "accessory" },
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
    drawComposite(spyCtx, LAYOUT, { body: null, eyes: null, outfit: null, hairstyle: null, accessory: null }, outfitDef());
    expect(calls).toContain(false);
  });
});
