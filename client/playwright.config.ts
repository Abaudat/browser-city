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
      // `appearance-screenshots.spec.ts` asserts nothing -- it only
      // leaves review images behind, so a slow runner or a dropped frame
      // in one of its real-time walker waits must never turn the merge
      // gate red. The `e2e-review-shots` project below runs it instead,
      // in a separate, non-gating CI job (`ci.yml`'s own `# bc:non-gating`
      // marker, `check-ci-gate.sh`).
      testIgnore: "**/appearance-screenshots.spec.ts",
    },
    {
      name: "chromium-review-shots",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/appearance-screenshots.spec.ts",
    },
  ],
});
