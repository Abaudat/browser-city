// Story 2.8 (FR147): the handshake proven against a real local
// SpacetimeDB and a real browser, at exactly the two places the unit
// suite cannot reach -- the wire (how many frames the client actually
// sends) and a real `fetch` (a routed-and-held response, not a fake).
// Everything else (every branch of `decideHandshake`, the boot gate's own
// order of calls, the bounded retry, the guarded reload) is unit-tested
// in `tests/unit/boot/**`.
//
// No `waitForTimeout` anywhere (the house rule -- see connection-notice.
// spec.ts's own header): the "zero frames while the refetch is in
// flight" proof below holds a routed response open on an explicit gate
// this test itself resolves, rather than sleeping past a guessed delay.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { readSpacetimeHandle } from "./spacetime-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The real, committed defs.json -- never a hand-typed fixture, so the
// stale copy below still has every field a real document needs
// (`parseDefs` rejects a malformed one) and its own `defs_version` is
// necessarily the one the live SpacetimeDB instance really publishes
// (`spacetime-harness.mjs` publishes `server/` itself, and check-defs-
// version-agrees.sh already guards the two staying equal).
const REAL_DEFS_PATH = path.resolve(__dirname, "../../public/defs/defs.json");
const REAL_DEFS: Record<string, unknown> = JSON.parse(readFileSync(REAL_DEFS_PATH, "utf-8"));
const REAL_DEFS_VERSION = REAL_DEFS.defs_version as string;
const REAL_DEFS_BODY = JSON.stringify(REAL_DEFS);
const STALE_DEFS_VERSION = "0000000000000000";
const STALE_DEFS_BODY = JSON.stringify({ ...REAL_DEFS, defs_version: STALE_DEFS_VERSION });

function frameCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__bc?.frameCount ?? 0);
}

function notice(page: Page) {
  return page.locator("[data-bc-notice]");
}

test("the matched-version path costs no additional round trip: exactly one client-to-server frame before the scene renders (FR147)", async ({
  page,
}) => {
  const handle = readSpacetimeHandle();
  const dbWsPrefix = handle.serverUrl.replace(/^http/, "ws");

  let sentCount = 0;
  page.on("websocket", (ws) => {
    if (!ws.url().startsWith(dbWsPrefix)) return; // never Vite's own HMR socket
    ws.on("framesent", () => {
      sentCount++;
    });
  });

  await page.goto("/");
  await page.waitForFunction(() => (window.__bc?.frameCount ?? 0) > 0, undefined, {
    timeout: 20_000,
  });

  // One subscribe message covers both `demo_ping` and `module_version` --
  // no extra reducer, no extra procedure, no second subscription.
  expect(sentCount).toBe(1);
});

test("stale defs_version: the client refetches cache-busted with the server's version, and draws zero frames until the fresh defs are in (FR147)", async ({
  page,
}) => {
  let releaseRefetch: () => void = () => {};
  const refetchGate = new Promise<void>((resolve) => {
    releaseRefetch = resolve;
  });
  let resolveRefetchRequested: () => void = () => {};
  const refetchRequested = new Promise<void>((resolve) => {
    resolveRefetchRequested = resolve;
  });
  const requestedUrls: string[] = [];

  await page.route("**/defs/defs.json*", async (route) => {
    const url = new URL(route.request().url());
    requestedUrls.push(url.search);
    if (!url.searchParams.has("v")) {
      // The boot gate's first, unversioned fetch -- this is what "the
      // client's own defs_version" means before any comparison happens.
      await route.fulfill({ status: 200, contentType: "application/json", body: STALE_DEFS_BODY });
      return;
    }
    // The refetch: held open, deliberately, until this test releases it --
    // never a fixed sleep, always an explicit gate.
    resolveRefetchRequested();
    await refetchGate;
    await route.fulfill({ status: 200, contentType: "application/json", body: REAL_DEFS_BODY });
  });

  await page.goto("/");
  await refetchRequested;

  // The refetch is in flight right now, deliberately held open -- the
  // scene must not have mounted a single frame yet.
  expect(await frameCount(page)).toBe(0);

  releaseRefetch();
  await page.waitForFunction(() => (window.__bc?.frameCount ?? 0) > 0, undefined, {
    timeout: 20_000,
  });

  expect(requestedUrls.filter((s) => !s.includes("v="))).toHaveLength(1);
  expect(requestedUrls.filter((s) => s.includes(`v=${REAL_DEFS_VERSION}`))).toHaveLength(1);
});

test("every defs request stays stale: no crash, no request storm, a visible notice, and zero frames ever drawn (NFR42)", async ({
  page,
}) => {
  let requestCount = 0;
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("**/defs/defs.json*", async (route) => {
    requestCount++;
    await route.fulfill({ status: 200, contentType: "application/json", body: STALE_DEFS_BODY });
  });

  await page.goto("/");

  await expect(notice(page)).toHaveText("Updating…", { timeout: 20_000 });
  expect(await frameCount(page)).toBe(0);
  // Bounded: the initial unversioned fetch plus a small, fixed number of
  // retries -- never an unbounded storm against the server.
  expect(requestCount).toBeLessThanOrEqual(4);
  expect(pageErrors).toEqual([]);
});
