// Story 4.5 (FR141, FR143): the device is the same person tomorrow. Real
// browser, real local SpacetimeDB; the identity token itself is never read
// here (the repository is public and these reports are uploaded) -- the
// specs read the public identity and character id the DEV hook exposes.
// Specs share one SpacetimeDB instance, so every assertion is on ids
// captured inside the test, never on table-wide counts.
import { type Browser, expect, type Page, test } from "@playwright/test";
// Pulls in `declare global { interface Window { __bc } }` -- types only.
import type {} from "../../src/net/e2e-hooks";
import { ZOOM } from "../../src/render/camera";
import { cellBottomCentre, worldPointPx } from "../../src/render/screen-position";
import { LINK_CARRIER_CELL, LINK_CARRIER_PROP_ID } from "../../src/test-street/link-carrier";
import { committedDefs } from "../unit/test-street/street-world";
import { waitForPlayerControllable } from "./boot-test-support";
import { canvasOf, canvasOffsetForWorldPx } from "./camera-test-support";
import { callReducer, readSpacetimeHandle } from "./spacetime-harness.mjs";

const IDENTITY_KEY = "bc.identity.v1";

/** Client-sent WebSocket frames up to the point the initial region has applied:
 * the global `subscribe` and the initial interest region's `subscribe`, and
 * nothing else (no reducer, procedure or extra request of ours establishes
 * identity). Measured on this harness (repeat runs, Chromium, the story 4.5
 * head merged with the story 4.3 region) -- a boot-time call added to either
 * path moves it and fails this spec. */
const FIRST_VISIT_FRAMES = 2;

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
  await page.waitForFunction(
    () =>
      performance.getEntriesByName("bc-boot:region-applied").length > 0 &&
      window.__bc?.worldClock !== undefined,
  );
  const first = frames.count();
  expect(first).toBe(FIRST_VISIT_FRAMES);

  const before = frames.count();
  await page.reload();
  await identityOf(page);
  await page.waitForFunction(
    () =>
      performance.getEntriesByName("bc-boot:region-applied").length > 0 &&
      window.__bc?.worldClock !== undefined,
  );
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

// ---------------------------------------------------------------------------
// Linking (FR143), against the harness's disposable local OIDC issuer.
// ---------------------------------------------------------------------------

/** A subject of this spec's own: the OIDC identity is issuer + subject, so
 * two specs sharing one would share an account (and its character). */
async function useOwnOidcAccount(label: string): Promise<void> {
  const issuer = readSpacetimeHandle().oidcIssuer as string;
  const sub = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await fetch(`${issuer}/admin/subject?sub=${encodeURIComponent(sub)}`, {
    method: "POST",
  });
  expect(response.ok).toBe(true);
}

async function setIssuedAudience(audience: string | null): Promise<void> {
  const issuer = readSpacetimeHandle().oidcIssuer as string;
  const query = audience === null ? "" : `?aud=${encodeURIComponent(audience)}`;
  const response = await fetch(`${issuer}/admin/audience${query}`, { method: "POST" });
  expect(response.ok).toBe(true);
}

/** Does the real link: the page leaves for the provider (which consents at
 * once) and boots back with the callback parameters stripped. The detour is
 * too quick to observe, so the marker on the old page is what proves a
 * full-page navigation happened. */
async function linkThroughProvider(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__bc?.startLink !== undefined);
  await page.evaluate(() => {
    (window as unknown as { __preLink?: boolean }).__preLink = true;
    void window.__bc?.startLink?.();
  });
  await page.waitForFunction(
    () =>
      (window as unknown as { __preLink?: boolean }).__preLink === undefined &&
      !window.location.search.includes("code=") &&
      window.__bc?.identity !== undefined,
    undefined,
    { timeout: 15_000 },
  );
}

test("a character linked on one device is reached from a fresh browser, and from the first again", async ({
  browser,
}) => {
  await setIssuedAudience(null);
  await useOwnOidcAccount("recovery");
  const a = await freshContextPage(browser);
  await a.goto("/");
  await identityOf(a);
  await a.waitForFunction(() => window.__bc?.createCharacter !== undefined);
  await a.evaluate(() => window.__bc?.createCharacter?.());
  const created = await characterOf(a);
  expect(await a.evaluate(() => window.__bc?.character?.linked)).toBe(false);

  await linkThroughProvider(a);
  await a.waitForFunction(() => window.__bc?.character?.linked === true, undefined, {
    timeout: 10_000,
  });
  expect((await characterOf(a)).characterId).toBe(created.characterId);

  // A brand-new context with empty storage signs in and reaches the same
  // character.
  const b = await freshContextPage(browser);
  await b.goto("/");
  const bIdentity = await identityOf(b);
  expect(await b.evaluate(() => window.__bc?.character)).toBeUndefined();
  await linkThroughProvider(b);
  await b.waitForFunction(() => window.__bc?.character?.linked === true, undefined, {
    timeout: 10_000,
  });
  expect(await characterOf(b)).toEqual(created);
  // Linking never changed who the device is.
  expect(await identityOf(b)).toBe(bIdentity);

  // And the first device, reloaded, still does.
  await a.reload();
  expect(await characterOf(a)).toEqual(created);
  await a.context().close();
  await b.context().close();
});

test("a token minted for another application cannot link a character", async ({ browser }) => {
  await useOwnOidcAccount("wrong-audience");
  await setIssuedAudience("some-other-app");
  try {
    const page = await freshContextPage(browser);
    const failed = page.waitForEvent("console", {
      predicate: (m) => m.text().includes("[identity] link was not completed"),
      timeout: 15_000,
    });
    await page.goto("/");
    await identityOf(page);
    await page.waitForFunction(() => window.__bc?.createCharacter !== undefined);
    await page.evaluate(() => window.__bc?.createCharacter?.());
    await characterOf(page);
    await linkThroughProvider(page);
    await failed;
    // The resumed page has no character until `my_character` delivers it again.
    await characterOf(page);
    expect(await page.evaluate(() => window.__bc?.character?.linked)).toBe(false);
    await page.context().close();
  } finally {
    await setIssuedAudience(null);
  }
});

// ---------------------------------------------------------------------------
// The link offer (FR143): an in-world object, offered once the character is a
// city day old, declined by walking away, not offered again inside the
// cool-off. Time passes through the dev-only `set_clock_speed` the harness
// module carries: a character's age is its real creation instant read on the
// city clock, so a jump (which moves the epoch under it) cannot age it, and
// only a faster clock can. The spec polls the offer, never sleeps.
// `set_clock_speed` is instance-wide: on CI `workers: 1` serialises every spec
// file, so no other spec can observe the fast clock, but locally the default
// worker count can run `city-clock.spec.ts` beside this one -- a local-only
// flake there is this, not a reason to widen a timeout.
// ---------------------------------------------------------------------------

const CARRIER_DEF_ID = committedDefs().objects.find((o) => o.key === "registry_post")?.id ?? -1;
const COOLOFF_DAYS = committedDefs().balance.find(
  (b) => b.key === "identity.link_prompt_cooloff_days",
)?.value;
const MIN_AGE_DAYS = committedDefs().balance.find(
  (b) => b.key === "identity.link_prompt_min_character_age_days",
)?.value;
const SUBCELLS = committedDefs().colliderSubcellsPerCell;
const FAST_CLOCK_SPEED = 100;

function balanceOf(key: string): number {
  const v = committedDefs().balance.find((b) => b.key === key)?.value;
  if (v === undefined) throw new Error(`no balance key '${key}'`);
  return v;
}

function worldPixelOfCell(cellX: number, cellY: number, floor: number) {
  const tile = balanceOf("render.tile_size_px");
  const storey = balanceOf("render.storey_height_px");
  const anchor = worldPointPx(
    cellBottomCentre(cellX, cellY).x,
    cellBottomCentre(cellX, cellY).y,
    floor,
    tile,
    storey,
    ZOOM,
    0,
  );
  return { x: anchor.x, y: anchor.y - tile / 2 };
}

async function sceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 15_000,
  });
  await waitForPlayerControllable(page, 15_000);
}

async function linkOfferPlaced(page: Page): Promise<boolean> {
  await page.waitForFunction(() => window.__bc?.linkOffer !== undefined, undefined, {
    timeout: 15_000,
  });
  return (await page.evaluate(() => window.__bc?.linkOffer?.placed)) ?? false;
}

async function newPlayerWithCharacter(browser: Browser): Promise<Page> {
  const page = await freshContextPage(browser);
  await page.goto("/");
  await identityOf(page);
  await page.waitForFunction(() => window.__bc?.createCharacter !== undefined);
  await page.evaluate(() => window.__bc?.createCharacter?.());
  await characterOf(page);
  return page;
}

test("a tab whose token cannot be stored is a session-only identity and cannot create a character", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__bc?.identity !== undefined, undefined, {
    timeout: 10_000,
  });
  expect(await page.evaluate(() => window.__bc?.identity?.persisted)).toBe(false);
  await page.waitForFunction(() => window.__bc?.createCharacter !== undefined);
  const refused = await page.evaluate(async () => {
    try {
      await window.__bc?.createCharacter?.();
      return false;
    } catch {
      return true;
    }
  });
  expect(refused).toBe(true);
  expect(await page.evaluate(() => window.__bc?.character)).toBeUndefined();
  await context.close();
});

/** Reloads until the offer is placed: the character became a city day old. */
async function reloadUntilOffered(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.reload();
        await sceneReady(page);
        return linkOfferPlaced(page);
      },
      { timeout: 90_000, intervals: [1_000] },
    )
    .toBe(true);
}

test("the link offer appears a city day after the character, is declined by walking away, and does not return inside the cool-off", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  expect(CARRIER_DEF_ID).toBeGreaterThan(0);
  expect(MIN_AGE_DAYS).toBe(1);
  await useOwnOidcAccount("offer");
  expect(COOLOFF_DAYS).toBeGreaterThan(1);
  await setIssuedAudience(null);

  const decliner = await newPlayerWithCharacter(browser);
  const taker = await newPlayerWithCharacter(browser);

  // A new character is not offered anything: the offer waits for a natural
  // moment, never the first minutes of play.
  await decliner.reload();
  await sceneReady(decliner);
  expect(await linkOfferPlaced(decliner)).toBe(false);

  // A city day passes, on a faster clock; put back at the end whatever
  // happens, so no other spec sees it.
  callReducer(readSpacetimeHandle(), "set_clock_speed", String(FAST_CLOCK_SPEED));
  try {
    await declineAndTake(decliner, taker);
  } finally {
    callReducer(readSpacetimeHandle(), "set_clock_speed", "1");
  }
});

async function declineAndTake(decliner: Page, taker: Page): Promise<void> {
  await reloadUntilOffered(decliner);
  const carrierOrderId = LINK_CARRIER_PROP_ID.toString();
  expect(await decliner.evaluate(() => window.__bc?.renderOrder ?? [])).toContain(carrierOrderId);

  // Decline: simply do not take it. Movement works...
  const before = await decliner.evaluate(() => window.__bc?.playerPosition);
  await decliner.keyboard.down("ArrowDown");
  await decliner.waitForFunction(
    (y) => (window.__bc?.playerPosition?.y ?? y) > y + 0.5,
    before?.y ?? 0,
    { timeout: 10_000 },
  );
  await decliner.keyboard.up("ArrowDown");
  await decliner.keyboard.down("ArrowUp");
  await decliner.waitForFunction(
    (y) => (window.__bc?.playerPosition?.y ?? 99) <= y + 0.05,
    before?.y ?? 0,
    { timeout: 10_000 },
  );
  // ...and an in-reach intent on something else still resolves: walk north
  // into the shop counter's reach row and click it.
  const counter = committedDefs().objects.find((o) => o.key === "shop_counter");
  const reach = counter?.interactAt;
  expect(reach).toBeDefined();
  const counterAnchorY = 2;
  const reachBottom = counterAnchorY + (reach?.y1 ?? 0) / SUBCELLS;
  await decliner.waitForFunction(
    (bottom) => (window.__bc?.playerPosition?.y ?? 99) < bottom,
    reachBottom,
    { timeout: 10_000 },
  );
  await decliner.keyboard.up("ArrowUp");
  const counterPos = await canvasOffsetForWorldPx(decliner, worldPixelOfCell(4, counterAnchorY, 0));
  await canvasOf(decliner).click({ position: counterPos });
  await expect
    .poll(() => decliner.evaluate(() => window.__bc?.intents?.map((i) => i.objectId) ?? []))
    .toEqual(["8"]);

  // Nothing was withheld, and a reload inside the cool-off shows no second
  // offer.
  await decliner.reload();
  await sceneReady(decliner);
  expect(await linkOfferPlaced(decliner)).toBe(false);
  expect(await decliner.evaluate(() => window.__bc?.renderOrder ?? [])).not.toContain(
    carrierOrderId,
  );
  await decliner.context().close();

  // Taking it: the other player walks to the carrier, uses it, and comes back
  // linked.
  await reloadUntilOffered(taker);
  await taker.keyboard.down("ArrowUp");
  await taker.waitForFunction(
    (y) => (window.__bc?.playerPosition?.y ?? 99) < y,
    LINK_CARRIER_CELL.y + 1,
    { timeout: 10_000 },
  );
  await taker.keyboard.up("ArrowUp");
  await taker.keyboard.down("ArrowRight");
  await taker.waitForFunction(
    (x) => (window.__bc?.playerPosition?.x ?? 0) >= x,
    LINK_CARRIER_CELL.x - 0.2,
    { timeout: 10_000 },
  );
  await taker.keyboard.up("ArrowRight");
  const carrierPos = await canvasOffsetForWorldPx(
    taker,
    worldPixelOfCell(LINK_CARRIER_CELL.x, LINK_CARRIER_CELL.y, LINK_CARRIER_CELL.floor),
  );
  await taker.evaluate(() => {
    (window as unknown as { __preLink?: boolean }).__preLink = true;
  });
  await canvasOf(taker).click({ position: carrierPos });
  await taker.waitForFunction(
    () =>
      (window as unknown as { __preLink?: boolean }).__preLink === undefined &&
      window.__bc?.character?.linked === true,
    undefined,
    { timeout: 20_000 },
  );
  await taker.context().close();
}
