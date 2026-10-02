// Story 4.5 (FR141, FR143): the device is the same person tomorrow. Real
// browser, real local SpacetimeDB; the identity token itself is never read
// here (the repository is public and these reports are uploaded) -- the
// specs read the public identity and character id the DEV hook exposes.
// Specs share one SpacetimeDB instance, so every assertion is on ids
// captured inside the test, never on table-wide counts.
import { type Browser, expect, type Page, test } from "@playwright/test";
// Pulls in `declare global { interface Window { __bc } }` -- types only.
import type {} from "../../src/net/e2e-hooks";
import { readSpacetimeHandle } from "./spacetime-harness.mjs";

const IDENTITY_KEY = "bc.identity.v1";

/** Every HTTP request this page makes to the SpacetimeDB host. */
function watchHostRequests(page: Page): string[] {
  const host = new URL(readSpacetimeHandle().serverUrl).host;
  const paths: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.host === host) paths.push(`${req.method()} ${url.pathname}`);
  });
  return paths;
}

/** Client-sent WebSocket frames. */
function countFramesSent(page: Page): { readonly count: () => number } {
  let n = 0;
  page.on("websocket", (ws) => {
    ws.on("framesent", () => {
      n += 1;
    });
  });
  return { count: () => n };
}

async function identityOf(page: Page): Promise<string> {
  await page.waitForFunction(() => window.__bc?.identity !== undefined, undefined, {
    timeout: 10_000,
  });
  const identity = await page.evaluate(() => window.__bc?.identity);
  expect(identity?.persisted).toBe(true);
  return identity?.identityHex ?? "";
}

async function characterOf(page: Page): Promise<{ characterId: string; createdAtMicros: string }> {
  await page.waitForFunction(() => window.__bc?.character !== undefined, undefined, {
    timeout: 10_000,
  });
  const c = await page.evaluate(() => window.__bc?.character);
  return { characterId: c?.characterId ?? "", createdAtMicros: c?.createdAtMicros ?? "" };
}

async function freshContextPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test("a first visit then a reload is the same identity and the same character", async ({
  browser,
}) => {
  const page = await freshContextPage(browser);
  const requests = watchHostRequests(page);
  await page.goto("/");

  const firstIdentity = await identityOf(page);
  // Exactly one key was written: the token's own.
  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual([IDENTITY_KEY]);
  // Zero extra round trips (FR141): a first visit is the WebSocket alone.
  expect(requests.filter((r) => r.includes("/v1/identity"))).toEqual([]);

  await page.waitForFunction(() => window.__bc?.createCharacter !== undefined);
  await page.evaluate(() => window.__bc?.createCharacter?.());
  const created = await characterOf(page);

  requests.length = 0;
  await page.reload();
  expect(await identityOf(page)).toBe(firstIdentity);
  expect(await characterOf(page)).toEqual(created);
  // A returning visit pays only the SDK's own websocket-token request.
  expect(requests.filter((r) => r.includes("/v1/identity"))).toEqual([
    "POST /v1/identity/websocket-token",
  ]);
  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual([IDENTITY_KEY]);

  // Control: a context with empty storage is someone else, so the equality
  // above cannot pass vacuously.
  const other = await freshContextPage(browser);
  await other.goto("/");
  expect(await identityOf(other)).not.toBe(firstIdentity);
  await page.context().close();
  await other.context().close();
});

test("a returning visit sends exactly as many frames as a first visit", async ({ browser }) => {
  const page = await freshContextPage(browser);
  const frames = countFramesSent(page);
  await page.goto("/");
  await identityOf(page);
  await page.waitForFunction(() => window.__bc?.worldClock !== undefined);
  const first = frames.count();
  expect(first).toBeGreaterThan(0);

  const before = frames.count();
  await page.reload();
  await identityOf(page);
  await page.waitForFunction(() => window.__bc?.worldClock !== undefined);
  expect(frames.count() - before).toBe(first);
  await page.context().close();
});

test("a stored token the server refuses is kept, with the connection notice shown", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const bogus = JSON.stringify({ version: 1, token: "not-a-token" });
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    [IDENTITY_KEY, bogus],
  );
  await page.goto("/");
  await expect(page.locator('[data-bc-surface="connection-notice"]')).toBeVisible({
    timeout: 10_000,
  });
  // Never an anonymous fallback: the stored value is byte-identical.
  expect(await page.evaluate((k) => window.localStorage.getItem(k), IDENTITY_KEY)).toBe(bogus);
  await context.close();
});
