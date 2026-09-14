// The "load every layer, release what loaded if one fails" step
// `appearance-texture.ts`'s `buildCompositeFrames` needs. Pure over
// injected `load`/`release`, so this needs no `fetch` and no
// `ImageBitmap`.
import { describe, expect, it, vi } from "vitest";
import { loadLayerImages } from "../../../../src/render/appearance/layer-images";

interface FakeBitmap {
  readonly sheet: string;
}

describe("loadLayerImages", () => {
  it("resolves one value per key, passing null sheets straight through as null", async () => {
    const load = vi.fn(async (sheet: string): Promise<FakeBitmap> => ({ sheet }));
    const release = vi.fn();

    const images = await loadLayerImages(
      { body: "body.png", eyes: null, outfit: "outfit.png" },
      load,
      release,
    );

    expect(images.body).toEqual({ sheet: "body.png" });
    expect(images.eyes).toBeNull();
    expect(images.outfit).toEqual({ sheet: "outfit.png" });
    expect(load).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
  });

  it("a failure in one layer releases every other layer that did load, exactly once, then rethrows", async () => {
    const release = vi.fn();
    const load = vi.fn(async (sheet: string): Promise<FakeBitmap> => {
      if (sheet === "hairstyle.png") throw new Error("504");
      return { sheet };
    });

    await expect(
      loadLayerImages(
        {
          body: "body.png",
          eyes: "eyes.png",
          outfit: "outfit.png",
          hairstyle: "hairstyle.png",
          accessory: null,
        },
        load,
        release,
      ),
    ).rejects.toThrow("504");

    expect(release).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledWith("body.png", { sheet: "body.png" });
    expect(release).toHaveBeenCalledWith("eyes.png", { sheet: "eyes.png" });
    expect(release).toHaveBeenCalledWith("outfit.png", { sheet: "outfit.png" });
    // The failed layer and the `null` layer are never released -- there
    // is nothing loaded to release for either.
    expect(release).not.toHaveBeenCalledWith("hairstyle.png", expect.anything());
  });

  it("every sheet failing releases nothing (nothing loaded) and still rethrows", async () => {
    const release = vi.fn();
    const load = vi.fn(async (): Promise<FakeBitmap> => {
      throw new Error("network down");
    });

    await expect(loadLayerImages({ body: "body.png" }, load, release)).rejects.toThrow(
      "network down",
    );
    expect(release).not.toHaveBeenCalled();
  });
});
