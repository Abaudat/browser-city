import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/net/**", "src/defs/**", "src/render/**", "src/demo/**"],
      // `src/net/bindings/**` is generated (never hand-tested). `src/
      // demo/**` is throwaway harness code (Tim's direction: fenced off
      // from the permanent render modules precisely so the whole
      // directory can be excluded here, by path, rather than by naming
      // individual files as they're added) -- it is still exercised by
      // real tests (`tests/unit/demo/**`), just not held to this bar.
      // `bootstrap.ts` is the pre-existing ping-demo shell. Every
      // permanent `src/render/**` module -- including the Pixi-touching
      // `pixi-order.ts`, which is sprite/container wiring and nothing
      // that decides an order or a position -- stays in scope; never
      // lower the bar or exclude a pure module.
      exclude: ["src/net/bindings/**", "src/render/bootstrap.ts", "src/demo/**"],
      thresholds: {
        lines: 90,
        branches: 90,
      },
    },
  },
});
