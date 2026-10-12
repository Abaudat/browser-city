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
// subscription applies; (d) the first frame renders behind the name prompt
// and the prompt takes typing. This runs against Maincloud as a fresh
// identity and must leave `character` untouched, so it never submits a
// name: submit -> controllable is the pre-merge e2e's, against a
// disposable database (story 4.6).
import { expect, test } from "@playwright/test";
import { BOOT_MARK } from "../../src/boot/boot-marks";
import { DEBUG_OVERLAYS } from "../../src/debug/overlays";

const EXPECT_WS_ORIGIN = process.env.BC_DEPLOY_EXPECT_WS_ORIGIN;
const EXPECT_DB = process.env.BC_DEPLOY_EXPECT_DB;

test("the deployed client boots for real: connects, subscribes and renders behind an interactive name prompt", async ({
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

  // The full target always comes straight from the env var, never a
  // relative goto()/baseURL join -- one fewer thing to get subtly wrong
  // between the live URL and the local rehearsal's preview URL.
  const deployUrl = process.env.BC_DEPLOY_URL;
  if (!deployUrl) {
    throw new Error("deploy-smoke.spec.ts: BC_DEPLOY_URL must be set");
  }
  await page.goto(deployUrl);

  // (d) the first frame rendered, the same 30s liveness bound every other
  // boot spec in this repo uses. The mark name is passed in as an
  // argument, never hardcoded here too -- a renamed mark must fail loudly
  // in one place, not pass here while failing everywhere else.
  await page.waitForFunction(
    (markName) => performance.getEntriesByName(markName).length > 0,
    BOOT_MARK.FIRST_FRAME_RENDERED,
    { timeout: 30_000 },
  );
  // The prompt is the page: visible, focused, and it takes typing. Typed
  // and cleared, never submitted -- a submit would create a character on
  // the live database.
  const prompt = page.locator('[data-bc-surface="name-prompt"] input');
  await expect(prompt).toBeVisible();
  await expect(prompt).toBeFocused();
  await page.keyboard.type("Smoke");
  await expect(prompt).toHaveValue("Smoke");
  await prompt.fill("");

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
  // The city clock's epoch row reached the client -- a world with no
  // `world_clock` row (or one the subscription never delivers) shows no
  // clock to any player. Bounded wait: the row can arrive after the mark
  // above.
  await page.waitForFunction(
    (markName) => performance.getEntriesByName(markName).length > 0,
    BOOT_MARK.CITY_CLOCK_KNOWN,
    { timeout: 10_000 },
  );
  expect(
    marks[BOOT_MARK.FIRST_FRAME_RENDERED],
    "first-frame-rendered mark never fired",
  ).toBeDefined();
  expect(
    marks[BOOT_MARK.NAME_SUBMITTED],
    "the smoke test must never submit a name",
  ).toBeUndefined();

  // (a) no failed request, no HTTP error response, no console/page error --
  // checked last, so a real connection/subscription failure above reports
  // its own specific cause rather than being buried in this list.
  expect(failures, `failures:\n${failures.join("\n")}`).toEqual([]);
});

// Story 4.6: the live deploy still proves a player can get in. A page whose
// storage is unusable keeps no identity token, so `create_character` is never
// called for it (FR141's visitor): it can answer the prompt, enter the world
// and move, and leaves `character` on the live database untouched. A deploy
// whose arrival gate never opens fails here, not in a player's tab.
test("a new player can answer the prompt and reach the world, without a character being created", async ({
  page,
}) => {
  const deployUrl = process.env.BC_DEPLOY_URL;
  if (!deployUrl) {
    throw new Error("deploy-smoke.spec.ts: BC_DEPLOY_URL must be set");
  }
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("storage denied", "SecurityError");
      },
    });
  });
  // Every frame this page sends, decoded: a reducer's name travels in it.
  const sent: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framesent", ({ payload }) => {
      sent.push(typeof payload === "string" ? payload : payload.toString("latin1"));
    });
  });

  await page.goto(deployUrl);
  const prompt = page.locator('[data-bc-surface="name-prompt"] input');
  await expect(prompt).toBeFocused();
  await page.keyboard.type("Smoke");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (markName) => performance.getEntriesByName(markName).length > 0,
    BOOT_MARK.PLAYER_CONTROLLABLE,
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-bc-surface="name-prompt"]')).toHaveCount(0);

  // The body answers: a production-safe mark fires when the player's own
  // position first changes -- absent before the key, set within 3 s of it.
  const stepMark = async () =>
    page.evaluate((name) => performance.getEntriesByName(name).length, BOOT_MARK.FIRST_STEP);
  expect(await stepMark(), "the body had already stepped before any key").toBe(0);
  await page.keyboard.down("KeyD");
  await page.waitForFunction(
    (name) => performance.getEntriesByName(name).length > 0,
    BOOT_MARK.FIRST_STEP,
    { timeout: 3_000 },
  );
  await page.keyboard.up("KeyD");

  // The search can see this page's outgoing calls at all (a positive
  // control: a reducer name that is certainly sent -- the clock sync), so
  // a decoder mismatch fails here instead of hiding a created character.
  expect(
    sent.some((frame) => frame.includes("sync_clock")),
    "the frame search cannot see sync_clock, so its silence about create_character proves nothing",
  ).toBe(true);
  // And no character was created for it.
  expect(sent.some((frame) => frame.includes("create_character"))).toBe(false);
});

// Story 4.6: the pre-merge rehearsal's own control for the test above, where
// creating a character is harmless: with storage working the same page's
// submit really does put `create_character` on the wire, and the search finds
// it. Skipped against the live deploy.
test("the frame search sees create_character when a character is created (rehearsal only)", async ({
  page,
}) => {
  test.skip(!process.env.BC_DEPLOY_REHEARSAL, "only against the disposable local database");
  const deployUrl = process.env.BC_DEPLOY_URL as string;
  const sent: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framesent", ({ payload }) => {
      sent.push(typeof payload === "string" ? payload : payload.toString("latin1"));
    });
  });
  await page.goto(deployUrl);
  await expect(page.locator('[data-bc-surface="name-prompt"] input')).toBeFocused();
  await page.keyboard.type("Rehearsal");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (markName) => performance.getEntriesByName(markName).length > 0,
    BOOT_MARK.PLAYER_CONTROLLABLE,
    { timeout: 30_000 },
  );
  await expect
    .poll(() => sent.some((frame) => frame.includes("create_character")), { timeout: 10_000 })
    .toBe(true);
});

// Story 1.12 (AC1, FR168): "off means off", against a real *production*
// build. Deliberately folded into this spec rather than given a server or
// a Playwright project of its own (Quentin/Tim's direction) -- the
// `deploy-smoke` project already runs against exactly the two targets
// that matter, and against nothing else:
//   - `ci.yml`'s `e2e` job, via `serve-for-deploy-smoke.mjs`'s
//     production-base preview build, before merge;
//   - `deploy.yml`'s `smoke` job, against the real deployed Pages URL.
//
// Every activation this drives comes from `DEBUG_OVERLAYS` itself, so an
// overlay added later is covered by this negative test on the day it is
// registered, with nothing to remember to update.
test("no debug overlay can be activated in a production build (FR168, AC1)", async ({ page }) => {
  const deployUrl = process.env.BC_DEPLOY_URL;
  if (!deployUrl) {
    throw new Error("deploy-smoke.spec.ts: BC_DEPLOY_URL must be set");
  }

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`page error: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console error: ${message.text()}`);
  });

  const ids = DEBUG_OVERLAYS.map((o) => o.id);
  const separator = deployUrl.includes("?") ? "&" : "?";
  // Every id at once, and then each one on its own -- a build that
  // somehow honoured only a single-id query would still be caught.
  for (const query of [ids.join(","), ...ids]) {
    await page.goto(`${deployUrl}${separator}debug=${query}`);
    await page.waitForFunction(
      (markName) => performance.getEntriesByName(markName).length > 0,
      BOOT_MARK.FIRST_FRAME_RENDERED,
      { timeout: 30_000 },
    );

    // Nothing drawn, by any of the markers the overlays use...
    expect(await page.locator("[data-bc-debug]").count(), `?debug=${query} drew an overlay`).toBe(
      0,
    );
    expect(await page.locator("[data-bc-collider]").count()).toBe(0);
    expect(await page.locator("[data-bc-sort-label]").count()).toBe(0);
    // ...and no handle to activate one with, because the module that
    // would define it was never emitted into this build.
    expect(
      await page.evaluate(() => ({
        debugHandle: typeof (window as unknown as { __bcDebug?: unknown }).__bcDebug,
        e2eHook: typeof (window as unknown as { __bc?: unknown }).__bc,
      })),
      `?debug=${query} left a debug handle on the page`,
    ).toEqual({ debugHandle: "undefined", e2eHook: "undefined" });
  }

  // And the query itself was not merely ignored loudly: a production
  // build has nothing to say about `?debug=` at all.
  expect(errors, `failures:\n${errors.join("\n")}`).toEqual([]);
});
