import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: [
        "src/boot/**",
        "src/debug/**",
        "src/net/**",
        "src/defs/**",
        "src/render/**",
        "src/test-street/**",
        "src/world/**",
        "src/input/**",
        "src/ui/**",
        "src/settings/**",
        "src/time/**",
      ],
      // `src/net/bindings/**` is generated (never hand-tested). `src/
      // test-street/**` is throwaway harness code (Tim's direction: fenced off
      // from the permanent render modules precisely so the whole
      // directory can be excluded here, by path, rather than by naming
      // individual files as they're added) -- it is still exercised by
      // real tests (`tests/unit/test-street/**`), just not held to this bar.
      // Every permanent `src/render/**` module -- including the
      // Pixi-touching `pixi-order.ts`, which is sprite/container wiring
      // and nothing that decides an order or a position -- stays in
      // scope; never lower the bar or exclude a pure module. Story 1.11:
      // `src/ui/**` (the options menu and the connection notice) and
      // `src/settings/**` (their persisted-storage idiom) stay in scope
      // the same way -- these are DOM-adjacent, but every one of their
      // effects is provable in jsdom, so there is no reason to exempt
      // them.
      // Story 1.12: `src/debug/**` is in scope at the same bar as
      // `src/render/**`, with nothing excluded -- including the SVG
      // adapters, which jsdom exercises for real. "It is only debug code"
      // is not a coverage exemption (Quentin's direction): debug code
      // that is wrong is the exact failure mode these overlays exist to
      // prevent, and an overlay that lies about a collider is worse than
      // no overlay at all.
      // Story 1.10/2.7: `composite-pages.ts` needs a real `OffscreenCanvas`
      // (an `OffscreenCanvas`-less node test cannot exercise it
      // meaningfully) and `character-part-pages.ts` needs a real `fetch`
      // runtime -- both thin adapters over the pure logic in
      // `composite.ts`/`composite-slots.ts`/`composite-look-cache.ts`/
      // `frame-rect.ts`/`resolve-layers.ts`/`appearance-cache.ts`, which
      // stay in scope. `appearance-texture.ts` (cycle 1, Quentin/Tim's
      // direction) owns real logic of its own -- the slot exhaustion/
      // staleness plumbing, the release-on-failure catch, the build-
      // once-per-slot frame cache -- so it is in scope too, tested with
      // `pixi.js` mocked and `CompositePageProvider`/`CharacterPageLoader`
      // fakes injected (`atlas-pages.test.ts`'s own idiom), never a real
      // `OffscreenCanvas`/`fetch`.
      exclude: [
        "src/net/bindings/**",
        // Story 2.8: a generated constant, the same idiom as bindings/ --
        // nothing to unit-test in a literal string assignment.
        "src/net/protocol-version.ts",
        "src/test-street/**",
        "src/render/appearance/composite-pages.ts",
        "src/render/appearance/character-part-pages.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 90,
      },
    },
  },
});
