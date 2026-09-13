import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // story 1.7's enclosure.spec.ts holds up to four sequential
  // `waitForFunction` calls across one test on a real keyboard-driven
  // walk through two floor transitions. 30s was tight even for the
  // three shorter specs; 60s gives real headroom (`retries: 0` still
  // means a real failure is red, not silently re-run away).
  timeout: 60_000,
  fullyParallel: false,
  // A flaky e2e is a failing e2e (Quentin, story 1.1): no re-run hides the
  // first red from a PR.
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    launchOptions: {
      // Chromium throttles `requestAnimationFrame` (the demo scene's own
      // `app.ticker`) to roughly 1/s for a page it considers backgrounded
      // -- a real, well-documented behaviour, not a Playwright quirk --
      // and CI's own multiple parallel worker pages are exactly the
      // condition that trips it (only one page is ever the "active" tab
      // at a time). `world/movement.ts`'s `MAX_DELTA_MS` clamp then
      // bounds each of those rare ticks to 100ms of simulated movement,
      // so a throttled page's walking speed drops by roughly the same
      // factor as its tick rate -- explaining a real-time-bound
      // keyboard walk needing far longer than 30s specifically under
      // parallel CI execution, never locally (`--repeat-each` with a
      // matching worker count never reproduced it). These flags disable
      // that whole class of background throttling for every launched
      // page, so a walk's real-time cost stays close to its simulated
      // one regardless of how many workers run alongside it.
      args: [
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ],
    },
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
