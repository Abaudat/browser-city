// Story 4.8 (FR140, FR179, NFR4): a dropped connection comes back by itself.
// One test per acceptance criterion, driven through `page.routeWebSocket` on
// the SpacetimeDB socket -- the shared local instance is never touched.
//
// The route handler is the test's lever: `mode` decides whether a new socket
// reaches the real server or is refused, `delayMs` holds the next one back,
// and every socket is counted, which is what proves single flight end to end.
// A witness page (`?remotePlayers`, its own context) reads the durable
// `player_position` row through its own subscription -- what the server holds,
// not what the player's page believes. No `waitForTimeout`: every wait is on
// an observable condition, and `retries` stays 0.
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { ZOOM } from "../../src/render/camera";
import { cellBottomCentre, worldPointPx } from "../../src/render/screen-position";
import { SHOP_COUNTER_DEF_ID, STREET_PROPS } from "../../src/test-street/fixture";
import { committedDefs } from "../unit/test-street/street-world";
import { canvasOf, canvasOffsetForWorldPx } from "./camera-test-support";
import { readSpacetimeHandle } from "./spacetime-harness.mjs";
import { walkRealCells } from "./walk-support";

type WebSocketRoute = Parameters<Parameters<Page["routeWebSocket"]>[1]>[0];

interface Sockets {
  count: number;
  mode: "pass" | "refuse";
  /** Holds the next socket back from the server for this long, once. */
  delayMs: number;
  servers: Array<ReturnType<WebSocketRoute["connectToServer"]>>;
  /** Per socket: while set, nothing crosses it in either direction and it is
   * never closed -- a socket that died unseen. */
  quiet: Array<{ silent: boolean }>;
}

async function routeDb(page: Page): Promise<Sockets> {
  const sockets: Sockets = { count: 0, mode: "pass", delayMs: 0, servers: [], quiet: [] };
  const pattern = `${readSpacetimeHandle().serverUrl.replace(/^http/, "ws")}/**`;
  await page.routeWebSocket(pattern, (ws) => {
    sockets.count += 1;
    if (sockets.mode === "refuse") {
      ws.close();
      return;
    }
    const gate = { silent: false };
    sockets.quiet.push(gate);
    const connect = () => {
      const server = ws.connectToServer();
      sockets.servers.push(server);
      ws.onMessage((m) => {
        if (!gate.silent) server.send(m);
      });
      server.onMessage((m) => {
        if (!gate.silent) ws.send(m);
      });
      ws.onClose(() => void server.close());
      server.onClose(() => void ws.close());
    };
    const delay = sockets.delayMs;
    sockets.delayMs = 0;
    if (delay > 0) setTimeout(connect, delay);
    else connect();
  });
  return sockets;
}

/** Every socket so far goes silent, still open. */
function goSilent(sockets: Sockets): void {
  for (const gate of sockets.quiet) gate.silent = true;
}

/** Closes the server side of every live socket: what the page sees as a drop. */
async function dropServer(sockets: Sockets): Promise<void> {
  const live = sockets.servers.splice(0);
  await Promise.all(live.map((s) => s.close()));
}

const notice = (page: Page) => page.locator("[data-bc-notice]");

async function openPlayer(page: Page): Promise<Sockets> {
  const sockets = await routeDb(page);
  await page.goto("/?freezeCrowd=1&remotePlayers=1");
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 60_000,
  });
  await page.waitForFunction(() => window.__bc?.createCharacter !== undefined);
  await page.evaluate(() => window.__bc?.createCharacter?.());
  await page.waitForFunction(() => window.__bc?.character !== undefined, undefined, {
    timeout: 20_000,
  });
  return sockets;
}

async function characterId(page: Page): Promise<string> {
  const id = await page.evaluate(() => window.__bc?.character?.characterId);
  if (!id) throw new Error("no character id");
  return id;
}

const position = (page: Page) => page.evaluate(() => window.__bc?.playerPosition);

/** The witness's view of `id`, in cells -- the durable row, via subscription. */
function witnessPose(witness: Page, id: string) {
  return witness.evaluate((cid) => window.__bc?.remotePlayers?.poses()[cid], id);
}

async function openWitness(page: Page, id: string): Promise<void> {
  await page.goto("/?freezeCrowd=1&remotePlayers=1");
  await page.waitForFunction((cid) => window.__bc?.remotePlayers?.poses()[cid] !== undefined, id, {
    timeout: 30_000,
  });
}

/** Resolves after `n` animation frames of the page itself. */
function frames(page: Page, n: number): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let seen = 0;
        const tick = () => (++seen >= count ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

test.describe.configure({ mode: "serial" });

test("a dropped connection returns by itself: the notice goes lost then reconnected, nothing reloads, the body stays put, and the sender resumes (FR140, NFR4)", async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  const sockets = await openPlayer(a);
  const id = await characterId(a);
  const witness = await (await browser.newContext()).newPage();
  await openWitness(witness, id);

  await a.evaluate(() => {
    (window as unknown as { __sentinel: number }).__sentinel = 4;
  });
  let navigations = 0;
  a.on("framenavigated", (frame) => {
    if (frame === a.mainFrame()) navigations += 1;
  });
  const before = await position(a);
  if (!before) throw new Error("no position");
  const socketsBefore = sockets.count;

  // The outage: refused until the test lets it through.
  sockets.mode = "refuse";
  await dropServer(sockets);
  await expect(notice(a)).toHaveText("Connection lost", { timeout: 5_000 });
  // The body holds, and the server row was not touched by the disconnect.
  await a.keyboard.down("ArrowRight");
  await frames(a, 45);
  await a.keyboard.up("ArrowRight");
  expect(await position(a)).toEqual(before);
  const rowDuring = await witnessPose(witness, id);
  const quantum = 1 / committedDefs().positionUnitsPerCell;
  expect(Math.abs((rowDuring?.x ?? Number.NaN) - before.x)).toBeLessThanOrEqual(quantum);
  expect(Math.abs((rowDuring?.y ?? Number.NaN) - before.y)).toBeLessThanOrEqual(quantum);
  expect(rowDuring?.floor).toBe(await a.evaluate(() => window.__bc?.playerFloor));
  // Retries are silent: the wording never flickers to "Connecting…".
  await expect(notice(a)).toHaveText("Connection lost");

  sockets.mode = "pass";
  await expect(notice(a)).toHaveText("Reconnected", { timeout: 30_000 });
  await expect(notice(a)).toBeHidden({ timeout: 5_000 });

  expect(sockets.count).toBeGreaterThan(socketsBefore);
  expect(await a.evaluate(() => (window as unknown as { __sentinel?: number }).__sentinel)).toBe(4);
  expect(navigations).toBe(0);
  await expect(a.locator("#test-street canvas")).toBeAttached();
  expect(await position(a)).toEqual(before);
  expect(await a.evaluate(() => window.__bc?.connection?.live())).toBe(1);

  // The sender resumed: a step is on the server.
  await walkRealCells(a, "east", 1.5, true);
  const rest = await position(a);
  if (!rest) throw new Error("no rest position");
  await witness.waitForFunction(
    ({ cid, x }) => Math.abs((window.__bc?.remotePlayers?.poses()[cid]?.x ?? 0) - x) < 0.05,
    { cid: id, x: rest.x },
    { timeout: 20_000 },
  );

  await a.context().close();
  await witness.context().close();
});

test("a drop while the page is frozen: on resume one new socket brings the player back with no input and the notice shows meanwhile (FR140)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const sockets = await openPlayer(a);
  const cdp = await context.newCDPSession(a);
  const socketsBefore = sockets.count;
  const before = await position(a);

  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await dropServer(sockets);
  // The new socket is held back long enough for the notice to show.
  sockets.delayMs = 1_500;
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  // What a real resume fires, all in the same tick.
  await a.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(notice(a)).toHaveText("Connection lost", { timeout: 5_000 });
  await expect(notice(a)).toHaveText("Reconnected", { timeout: 20_000 });
  await expect(notice(a)).toBeHidden({ timeout: 5_000 });
  // Single flight: the whole burst made exactly one new socket.
  expect(sockets.count).toBe(socketsBefore + 1);
  expect(await a.evaluate(() => window.__bc?.connection?.live())).toBe(1);
  expect(await position(a)).toEqual(before);

  await context.close();
});

test("the world moved while away: after reconnecting, another player's new position is drawn, with no reload (FR140)", async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  const sockets = await openPlayer(a);
  const b = await (await browser.newContext()).newPage();
  await openPlayer(b);
  const bId = await characterId(b);
  await a.waitForFunction((cid) => window.__bc?.remotePlayers?.poses()[cid] !== undefined, bId, {
    timeout: 30_000,
  });
  await a.evaluate(() => {
    (window as unknown as { __sentinel: number }).__sentinel = 9;
  });

  sockets.mode = "refuse";
  await dropServer(sockets);
  await expect(notice(a)).toHaveText("Connection lost", { timeout: 5_000 });

  // B walks while A is cut off.
  await walkRealCells(b, "east", 2.5, true);
  const bRest = await position(b);
  if (!bRest) throw new Error("no position for B");

  sockets.mode = "pass";
  await expect(notice(a)).toHaveText("Reconnected", { timeout: 30_000 });
  await a.waitForFunction(
    ({ cid, x }) => Math.abs((window.__bc?.remotePlayers?.poses()[cid]?.x ?? 0) - x) < 0.05,
    { cid: bId, x: bRest.x },
    { timeout: 20_000 },
  );
  expect(await a.evaluate(() => (window as unknown as { __sentinel?: number }).__sentinel)).toBe(9);
  expect(await a.evaluate(() => window.__bc?.connection?.live())).toBe(1);

  await a.context().close();
  await b.context().close();
});

test("while the connection is down the body answers no click: no intent and no refusal, and it answers again once back", async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  const sockets = await openPlayer(a);
  const counter = STREET_PROPS.find((p) => "defId" in p && p.defId === SHOP_COUNTER_DEF_ID);
  if (!counter) throw new Error("no counter in the fixture");
  const balance = (key: string): number => {
    const entry = committedDefs().balance.find((b) => b.key === key);
    if (!entry) throw new Error(`no balance key ${key}`);
    return entry.value;
  };
  const tile = balance("render.tile_size_px");
  const clickCounter = async () => {
    const centre = cellBottomCentre(counter.x, counter.y);
    const anchor = worldPointPx(
      centre.x,
      centre.y,
      counter.floor,
      tile,
      balance("render.storey_height_px"),
      ZOOM,
      0,
    );
    const position = await canvasOffsetForWorldPx(a, { x: anchor.x, y: anchor.y - tile / 2 });
    await canvasOf(a).click({ position });
  };
  const refusals = () => a.evaluate(() => window.__bc?.ignoredIntents ?? []);

  sockets.mode = "refuse";
  await dropServer(sockets);
  await expect(notice(a)).toHaveText("Connection lost", { timeout: 5_000 });
  await clickCounter();
  await frames(a, 30);
  expect(await refusals()).toEqual([]);
  expect(await a.evaluate(() => window.__bc?.intents ?? [])).toEqual([]);

  sockets.mode = "pass";
  await expect(notice(a)).toHaveText("Reconnected", { timeout: 30_000 });
  // The player starts out of the counter's reach: a click is now refused.
  await clickCounter();
  await expect.poll(refusals).toEqual([String(counter.id)]);

  await a.context().close();
});

test("a laptop lid with a socket that died unseen: on resume the probe finds it silent, rebuilds it, and one new socket brings the player back (FR140)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const sockets = await openPlayer(a);
  const cdp = await context.newCDPSession(a);
  const socketsBefore = sockets.count;
  const before = await position(a);

  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  // The socket stays open on both sides but carries nothing.
  goSilent(sockets);
  // The rebuilt socket is held back long enough for the notice to show.
  sockets.delayMs = 1_500;
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await a.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // Nothing but the wake-then-probe chain can notice: no close ever arrives.
  await expect(notice(a)).toHaveText("Connection lost", { timeout: 20_000 });
  await expect(notice(a)).toHaveText("Reconnected", { timeout: 30_000 });
  await expect(notice(a)).toBeHidden({ timeout: 5_000 });
  expect(sockets.count).toBe(socketsBefore + 1);
  expect(await a.evaluate(() => window.__bc?.connection?.live())).toBe(1);
  expect(await position(a)).toEqual(before);

  await context.close();
});
