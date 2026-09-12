import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/net/**", "src/defs/**", "src/render/**"],
      // `src/net/bindings/**` is generated (never hand-tested); the Pixi
      // adapter/demo-scene shell (`pixi-scene.ts`) and the pre-existing
      // ping bootstrap (`bootstrap.ts`) are the only files allowed to
      // import `pixi.js` or touch a canvas -- Quentin's direction is to
      // scope the coverage report around them, never to lower the bar or
      // exclude a pure module (`sort-key.ts`, `decompose.ts`,
      // `layer-ranks.ts` all stay in scope).
      exclude: ["src/net/bindings/**", "src/render/bootstrap.ts", "src/render/pixi-scene.ts"],
      thresholds: {
        lines: 90,
        branches: 90,
      },
    },
  },
});
