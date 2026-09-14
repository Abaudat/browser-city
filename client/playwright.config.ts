import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  // A flaky e2e is a failing e2e (Quentin, story 1.1): no re-run hides the
  // first red from a PR.
  retries: 0,
  // Every spec shares one `webServer` -- one disposable SpacetimeDB
  // instance, one Vite dev server (`serve-for-e2e.mjs`) -- so distinct
  // test files were never running against isolated backends; running them
  // on multiple workers only ever bought parallelism on a shared, CPU-
  // bound runner. On a small CI machine that contention reliably pushed
  // two unrelated, otherwise-reliable specs (story 1.10's own composite
  // comparison and story 1.9's `intents.spec.ts`) right up against their
  // own timeouts, reproducibly across runs, never locally. Serial on CI
  // removes that contention outright rather than chasing it with a wider
  // and wider timeout; locally (more cores, no shared-runner contention)
  // the default multi-worker heuristic stays.
  workers: process.env.CI ? 1 : undefined,
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
      // Story 1.13: the perf harness is its own project below, and the
      // functional run never pays for its minutes of walking.
      testIgnore: /street-perf\.spec\.ts/,
    },
    {
      // NFR2's measurement harness and regression gate. Never part of
      // `npm run test:e2e`: `npm run test:e2e:perf` is the only thing
      // that selects it, and `BC_SOAK_MS` turns the short run into the
      // 10-minute soak.
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /street-perf\.spec\.ts/,
    },
  ],
});
