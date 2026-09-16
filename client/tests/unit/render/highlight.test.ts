// `render/highlight.ts`'s own unit tests (Tim/Quentin's direction, story
// 1.15): moved from `test-street/scene.test.ts`'s `highlightOverlayAlpha`
// suite now that the function itself lives here, plus the truth-table and
// property coverage the promotion out of throwaway scaffolding demands.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BASIC_BLEND_MODES,
  HIGHLIGHT_BLEND_MODE,
  type HighlightSourceView,
  highlightOverlayAlpha,
  highlightOverlaySpec,
} from "../../../src/render/highlight";

const CEILING = 0.18;

describe("highlightOverlayAlpha", () => {
  it("at strength 100, is the bare ceiling*sourceAlpha", () => {
    expect(highlightOverlayAlpha(CEILING, 100, 1)).toBeCloseTo(0.18, 10);
    expect(highlightOverlayAlpha(CEILING, 100, 0.5)).toBeCloseTo(0.09, 10);
  });

  it("scales linearly with strength", () => {
    expect(highlightOverlayAlpha(CEILING, 50, 1)).toBeCloseTo(0.09, 10);
    expect(highlightOverlayAlpha(CEILING, 20, 1)).toBeCloseTo(0.036, 10);
  });

  it("strength 0 means no highlight at all", () => {
    expect(highlightOverlayAlpha(CEILING, 0, 1)).toBe(0);
  });

  it("is proportional to the source sprite's own alpha, never exceeding it", () => {
    expect(highlightOverlayAlpha(CEILING, 100, 0.4)).toBeCloseTo(CEILING * 0.4, 10);
    expect(highlightOverlayAlpha(CEILING, 100, 0)).toBe(0);
  });

  it("junk strength outside [0, 100] is clamped, never negative and never above the ceiling*sourceAlpha", () => {
    expect(highlightOverlayAlpha(CEILING, -50, 1)).toBe(0);
    expect(highlightOverlayAlpha(CEILING, 1000, 1)).toBeCloseTo(CEILING, 10);
    expect(highlightOverlayAlpha(CEILING, Number.NaN, 1)).toBe(0);
  });

  it("inv_highlight_alpha_bounded: monotone non-decreasing in strength, proportional to source alpha, never exceeding it, always within [0, 1] -- for any strength in [0, 100] and for junk outside it", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (ceilingAlpha, strengthA, strengthB, sourceAlpha) => {
          const [lo, hi] = strengthA <= strengthB ? [strengthA, strengthB] : [strengthB, strengthA];
          const alphaLo = highlightOverlayAlpha(ceilingAlpha, lo, sourceAlpha);
          const alphaHi = highlightOverlayAlpha(ceilingAlpha, hi, sourceAlpha);
          expect(alphaHi).toBeGreaterThanOrEqual(alphaLo - 1e-12);
          for (const alpha of [alphaLo, alphaHi]) {
            expect(alpha).toBeGreaterThanOrEqual(-1e-12);
            expect(alpha).toBeLessThanOrEqual(Math.max(0, ceilingAlpha) * sourceAlpha + 1e-12);
            expect(alpha).toBeLessThanOrEqual(1 + 1e-9);
          }
        },
      ),
    );
  });
});

describe("BASIC_BLEND_MODES / HIGHLIGHT_BLEND_MODE", () => {
  it("the highlight only ever uses one of the four renderer-native blend modes", () => {
    expect(BASIC_BLEND_MODES).toContain(HIGHLIGHT_BLEND_MODE);
  });
});

function sourceView(
  overrides: Partial<HighlightSourceView<string>> = {},
): HighlightSourceView<string> {
  return {
    texture: "bin",
    alpha: 1,
    anchorX: 0.5,
    anchorY: 1,
    x: 10,
    y: 20,
    scaleX: 1,
    scaleY: 1,
    ...overrides,
  };
}

describe("highlightOverlaySpec", () => {
  it("mirrors the source's own texture, anchor, position and scale exactly", () => {
    const spec = highlightOverlaySpec(
      sourceView({
        texture: "trashBin",
        anchorX: 0.5,
        anchorY: 1,
        x: 42,
        y: 7,
        scaleX: 2,
        scaleY: 3,
      }),
      CEILING,
      100,
    );
    expect(spec.texture).toBe("trashBin");
    expect(spec.anchorX).toBe(0.5);
    expect(spec.anchorY).toBe(1);
    expect(spec.x).toBe(42);
    expect(spec.y).toBe(7);
    expect(spec.scaleX).toBe(2);
    expect(spec.scaleY).toBe(3);
    expect(spec.blendMode).toBe(HIGHLIGHT_BLEND_MODE);
  });

  it("computes alpha through highlightOverlayAlpha, never a second formula", () => {
    const spec = highlightOverlaySpec(sourceView({ alpha: 0.5 }), CEILING, 60);
    expect(spec.alpha).toBeCloseTo(highlightOverlayAlpha(CEILING, 60, 0.5), 10);
  });
});
