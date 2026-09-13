import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // story 1.7's enclosure.spec.ts holds up to four sequential
  // `waitForFunction` calls (each up to 15s) across one test on a real
  // keyboard-driven walk through two floor transitions -- a shared,
  // 2-core CI runner has been observed taking ~2.7x longer than a local
  // run to cover the same real-time-bound walk (a slower/contended
  // WebGL frame rate, not a logic bug: `world/movement.ts`'s own
  // `MAX_DELTA_MS` clamp bounds a single frame's distance, so a slow
  // runner takes longer wall-clock time to cover a fixed distance, it
  // never skips over a transition anchor). 30s was tight even for the
  // three shorter specs; 60s gives real headroom without hiding an
  // actual hang (`retries: 0` still means a real failure is red, not
  // silently re-run away).
  timeout: 60_000,
  fullyParallel: false,
  // A flaky e2e is a failing e2e (Quentin, story 1.1): no re-run hides the
  // first red from a PR.
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  // serve-for-e2e.mjs starts a disposable local SpacetimeDB, publishes the
  // module, and only then execs Vite with VITE_ env vars pointing at it --
  // see that file for why this replaces a separate globalSetup step.
  webServer: {
    command: "node tests/e2e/serve-for-e2e.mjs",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
