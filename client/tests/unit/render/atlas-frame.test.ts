import { describe, expect, it } from "vitest";
import { atlasFrameRect } from "../../../src/render/atlas-frame";

describe("atlasFrameRect", () => {
  it("maps an AtlasRect's page-pixel fields to a plain FrameRect, gutter already excluded", () => {
    expect(atlasFrameRect({ page: 0, x: 1, y: 1, w: 16, h: 32 })).toEqual({
      x: 1,
      y: 1,
      width: 16,
      height: 32,
    });
  });

  it("is a pure mapping -- same input, same output, page never leaks into the rect", () => {
    const a = atlasFrameRect({ page: 3, x: 10, y: 20, w: 48, h: 64 });
    const b = atlasFrameRect({ page: 3, x: 10, y: 20, w: 48, h: 64 });
    expect(a).toEqual(b);
    expect(a).not.toHaveProperty("page");
  });
});
