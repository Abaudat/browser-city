// The one expensive test the socket crossing earns (Quentin, story 1.1):
// a reducer write, over a real local SpacetimeDB, observed by a real
// browser client through the SDK's onInsert callback, within the
// acceptance criterion's one-second budget. Everything else about
// `demo_ping` is covered by tests/unit/*.test.ts against fabricated data.
import { expect, test } from "@playwright/test";
// Pulls in `declare global { interface Window { __bc } }` -- types only,
// nothing imported at runtime.
import type {} from "../../src/net/e2e-hooks";
import { callReducer, readSpacetimeHandle } from "./spacetime-harness.mjs";

test("a reducer write reaches the subscribed client within one second", async ({ page }) => {
  await page.goto("/");

  const handle = readSpacetimeHandle();
  const message = `bc-e2e-${Date.now()}`;

  // The write is issued through the CLI, not the observing client -- a
  // real cold `spacetime call` process spawn, config resolution and
  // connect, all of which is deliberately *not* part of the measured
  // interval below. The budget is server-commit-to-observation
  // (`writtenAtMs`, `ctx.timestamp` in `send_ping`, to `observedAtMs`),
  // not CLI startup noise.
  callReducer(handle, "send_ping", message);

  await page.waitForFunction(
    (expected) => window.__bc?.pings.some((p) => p.message === expected) ?? false,
    message,
    { timeout: 5_000 },
  );

  const observation = await page.evaluate(
    (expected) => window.__bc?.pings.find((p) => p.message === expected),
    message,
  );

  expect(observation).toBeDefined();
  expect(observation?.message).toBe(message);

  const deltaMs = (observation?.observedAtMs ?? Number.NaN) - (observation?.writtenAtMs ?? 0);
  expect(deltaMs).toBeGreaterThanOrEqual(0);
  expect(deltaMs).toBeLessThan(1_000);
});
