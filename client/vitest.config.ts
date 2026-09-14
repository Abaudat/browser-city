import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: [
        "src/net/**",
        "src/defs/**",
        "src/render/**",
        "src/test-street/**",
        "src/world/**",
        "src/input/**",
        "src/ui/**",
      ],
      // `src/net/bindings/**` is generated (never hand-tested). `src/
      // test-street/**` is throwaway harness code (Tim's direction: fenced off
      // from the permanent render modules precisely so the whole
      // directory can be excluded here, by path, rather than by naming
      // individual files as they're added) -- it is still exercised by
      // real tests (`tests/unit/test-street/**`), just not held to this bar.
      // `bootstrap.ts` is the pre-existing ping-demo shell. Every
      // permanent `src/render/**` module -- including the Pixi-touching
      // `pixi-order.ts`, which is sprite/container wiring and nothing
      // that decides an order or a position -- stays in scope; never
      // lower the bar or exclude a pure module.
      // Story 1.10: `composite-canvas.ts` needs a real `OffscreenCanvas`
      // (an `OffscreenCanvas`-less node test cannot exercise it
      // meaningfully) and `part-sheets.ts` needs a real Vite
      // `import.meta.glob`/`fetch` runtime -- both thin adapters over the
      // pure logic in `composite.ts`/`frame-rect.ts`/`resolve-layers.ts`/
      // `appearance-cache.ts`, which stay in scope. `appearance-texture.ts`
      // is the adapter composing those two together plus the cache; no
      // logic of its own remains once its inputs are each covered.
      exclude: [
        "src/net/bindings/**",
        "src/render/bootstrap.ts",
        "src/test-street/**",
        "src/render/appearance/composite-canvas.ts",
        "src/render/appearance/part-sheets.ts",
        "src/render/appearance/appearance-texture.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 90,
      },
    },
  },
});
