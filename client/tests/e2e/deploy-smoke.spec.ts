// The deploy story's post-deploy smoke check -- Quentin's rule: "an HTTP
// 200 does not count as a smoke test". Run in two places against the
// `deploy-smoke` Playwright project (playwright.config.ts), which starts
// no webServer of its own:
//   - `.github/workflows/deploy.yml`'s `smoke` job, against the real,
//     already-deployed Pages URL and the real Maincloud database, after
//     the meta tag below proves Pages actually propagated this deploy;
//   - `.github/workflows/ci.yml`'s `e2e` job (`serve-for-deploy-smoke.mjs`),
//     against a production-base build under /browser-city/, backed by a
//     disposable local SpacetimeDB -- so a broken spec, or a base that
//     only works at `/`, is caught before merge.
//
// Four things, all real: (a) the page loads with no failed request and no
// console/page error; (b) the WebSocket actually dials the configured
// Maincloud URI and database, not merely "some" URL; (c) the initial
// subscription applies; (d) the player-controllable mark fires -- the
// same honesty bar boot-marks.spec.ts holds every other mark to.
import { expect, test } from "@playwright/test";
import { BOOT_MARK } from "../../src/boot/boot-marks";

const EXPECT_WS_ORIGIN = process.env.BC_DEPLOY_EXPECT_WS_ORIGIN;
const EXPECT_DB = process.env.BC_DEPLOY_EXPECT_DB;

test("the deployed client boots for real: connects, subscribes and reaches player-controllable", async ({
  page,
}) => {
  // A smoke test with nothing to check the connection against is not a
  // smoke test -- fail loudly rather than silently asserting less than
  // the caller intended.
  if (!EXPECT_WS_ORIGIN || !EXPECT_DB) {
    throw new Error(
      "deploy-smoke.spec.ts: BC_DEPLOY_EXPECT_WS_ORIGIN and BC_DEPLOY_EXPECT_DB must both be set",
    );
  }

  const failures: string[] = [];
  page.on("requestfailed", (request) => {
    failures.push(`request failed: ${request.url()} -- ${request.failure()?.errorText ?? "?"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  page.on("pageerror", (error) => {
    failures.push(`page error: ${String(error)}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console error: ${message.text()}`);
  });

  let wsUrl: string | undefined;
  page.on("websocket", (ws) => {
    wsUrl ??= ws.url();
  });

  // Never a relative goto()/baseURL join: this project's baseURL already
  // carries a query string (?bc-token=...) when the caller sets one, and
  // URL-resolving a relative path against it would silently drop that
  // query string. The full target always comes straight from the env var.
  const deployUrl = process.env.BC_DEPLOY_URL;
  if (!deployUrl) {
    throw new Error("deploy-smoke.spec.ts: BC_DEPLOY_URL must be set");
  }
  await page.goto(deployUrl);

  // (d) player-controllable, the same 30s liveness bound every other boot
  // spec in this repo uses.
  await page.waitForFunction(
    () => performance.getEntriesByName("bc-boot:player-controllable").length > 0,
    undefined,
    { timeout: 30_000 },
  );

  // (b) the WebSocket dialled the configured Maincloud URI and database --
  // client/src/net/connection.ts's own DbConnection.builder() call, never
  // "some" WebSocket.
  expect(wsUrl, "no WebSocket connection was ever opened").toBeDefined();
  const expectedPrefix = `${EXPECT_WS_ORIGIN}/v1/database/${EXPECT_DB}/subscribe`;
  expect(
    wsUrl?.startsWith(expectedPrefix),
    `expected the WebSocket to dial '${expectedPrefix}...', got '${wsUrl}'`,
  ).toBe(true);

  // (c) the initial subscription applied, and (b)'s handshake really did
  // open -- both read from the same permanent marks NFR1's harness uses,
  // never re-derived.
  const marks = await page.evaluate(() =>
    Object.fromEntries(
      performance.getEntriesByType("mark").map((entry) => [entry.name, entry.startTime]),
    ),
  );
  expect(marks[BOOT_MARK.HANDSHAKE_OPEN], "handshake never opened").toBeDefined();
  expect(marks[BOOT_MARK.SUBSCRIPTION_APPLIED], "initial subscription never applied").toBeDefined();
  expect(
    marks[BOOT_MARK.PLAYER_CONTROLLABLE],
    "player-controllable mark never fired",
  ).toBeDefined();

  // (a) no failed request, no HTTP error response, no console/page error --
  // checked last, so a real connection/subscription failure above reports
  // its own specific cause rather than being buried in this list.
  expect(failures, `failures:\n${failures.join("\n")}`).toEqual([]);
});
