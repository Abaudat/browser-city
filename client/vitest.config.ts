import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/net/**"],
      exclude: ["src/net/bindings/**"],
      thresholds: {
        lines: 90,
        branches: 90,
      },
    },
  },
});
