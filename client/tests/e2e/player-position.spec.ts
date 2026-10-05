// Story 4.4 (FR138): one player's walk seen from a second browser, at exactly
// the places a unit test with a fake clock cannot reach -- the bytes the real
// client puts on the WebSocket, and what a second page really draws.
//
// A walks through `walk-support.ts`. B records, inside the page
// (`window.__bc.remotePlayers`), what it draws of A on every animation frame
// and the samples it received meanwhile -- never polled from Node. Frame-time
// numbers stay in the unit properties, where the clock is synthetic. No
// `waitForTimeout`: every wait is on an observable condition.
//
// Both pages opt in with `?remotePlayers`: every other spec draws no other
// players, so the shared instance's leftovers never reach a pixel baseline.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { parseDefs } from "../../src/defs/parse";
import type {} from "../../src/net/e2e-hooks";
import { readSpacetimeHandle } from "./spacetime-harness.mjs";
import { walkRealCells } from "./walk-support";

const DEFS = parseDefs(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../public/defs/defs.json", import.meta.url)), "utf-8"),
  ),
);
const balance = (key: string): number => {
  const entry = DEFS.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance entry ${key}`);
  return entry.value;
};
const HZ = balance("net.player_position_hz");
const QUANTUM = 1 / DEFS.positionUnitsPerCell;
const WALK_CELLS = 2.5;
const HOP_CELLS = 0.2;

/** A page whose position writes are counted from the first frame it sends. */
async function countedPage(browser: Browser): Promise<{ page: Page; sends: () => number }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  let sends = 0;
  // Armed before the page loads: the socket opens during `goto`.
  const dbWsPrefix = readSpacetimeHandle().serverUrl.replace(/^http/, "ws");
  page.on("websocket", (ws) => {
    if (!ws.url().startsWith(dbWsPrefix)) return;
    ws.on("framesent", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString("latin1");
      sends += text.match(/set_player_position/g)?.length ?? 0;
    });
  });
  await page.goto("/?freezeCrowd=1&remotePlayers=1");
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 60_000,
  });
  return { page, sends: () => sends };
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

test("a walk is drawn smoothly on a second page, sent at the dial's rate, and a standing player costs nothing", async ({
  browser,
}) => {
  const a = await countedPage(browser);
  const b = await countedPage(browser);
  await b.page.bringToFront();

  // A page with no character puts no position write on the wire, walking or
  // not: every deployed visitor is in this state, and a refused call is
  // uncounted by the `position` class, so only the wire can show it.
  await walkRealCells(a.page, "hop", HOP_CELLS, true);
  await frames(a.page, 90);
  expect(a.sends()).toBe(0);

  // A has a character: its sender starts and writes the spawn position.
  await a.page.waitForFunction(() => window.__bc?.createCharacter !== undefined);
  await a.page.evaluate(() => window.__bc?.createCharacter?.());
  await a.page.waitForFunction(() => window.__bc?.character !== undefined, undefined, {
    timeout: 20_000,
  });
  const characterId = await a.page.evaluate(() => window.__bc?.character?.characterId);
  if (!characterId) throw new Error("no character id");

  await b.page.waitForFunction(
    (id) => window.__bc?.remotePlayers?.poses()[id] !== undefined,
    characterId,
    { timeout: 20_000 },
  );
  const rowUpdates = (id: string) =>
    b.page.evaluate((cid) => {
      const r = window.__bc?.region;
      return (
        (r?.inserts[`playerPosition:${cid}`] ?? 0) + (r?.updates[`playerPosition:${cid}`] ?? 0)
      );
    }, id);
  const updatesBefore = await rowUpdates(characterId);

  await b.page.evaluate(() => window.__bc?.remotePlayers?.startTrace());
  const sendsBefore = a.sends();
  const startedAt = Date.now();
  await walkRealCells(a.page, "east", WALK_CELLS, true);
  const walkMs = Date.now() - startedAt;

  // B converges to A's own rest position within one quantum.
  const rest = await a.page.evaluate(() => window.__bc?.playerPosition);
  if (!rest) throw new Error("no rest position");
  await b.page.waitForFunction(
    ({ id, x, y, q }) => {
      const p = window.__bc?.remotePlayers?.poses()[id];
      return p !== undefined && Math.abs(p.x - x) <= q && Math.abs(p.y - y) <= q;
    },
    { id: characterId, x: rest.x, y: rest.y, q: QUANTUM },
    { timeout: 20_000 },
  );
  const trace = await b.page.evaluate(
    () => window.__bc?.remotePlayers?.stopTrace() ?? { frames: {}, samples: {} },
  );
  const drawn = trace.frames[characterId] ?? [];
  const received = trace.samples[characterId] ?? [];
  expect(drawn.length, "B drew nothing of A").toBeGreaterThan(0);
  expect(received.length, "B received nothing of A").toBeGreaterThan(1);
  expect((await rowUpdates(characterId)) - updatesBefore).toBeGreaterThan(0);

  // On a straight walk it never steps backwards.
  for (let i = 1; i < drawn.length; i++) {
    expect(drawn[i]?.x ?? 0).toBeGreaterThanOrEqual(drawn[i - 1]?.x ?? 0);
  }
  // It interpolates rather than snaps: at least one drawn position lies
  // strictly between two consecutive samples B received. Holds at any frame
  // pacing that draws a frame while a segment is being walked.
  const between = drawn.some((f) =>
    received.some((s, i) => {
      const next = received[i + 1];
      return next !== undefined && s.x < f.x && f.x < next.x;
    }),
  );
  expect(between, "no drawn position fell between two received samples").toBe(true);

  // The wire: A's sends over the walk are at most duration * rate + 2.
  const walkSends = a.sends() - sendsBefore;
  expect(walkSends).toBeGreaterThan(0);
  expect(walkSends).toBeLessThanOrEqual((walkMs / 1000) * HZ + 2);

  // A standing player costs zero calls over a standing window.
  const standing = a.sends();
  await frames(a.page, 90);
  expect(a.sends()).toBe(standing);

  // A, which also opts in and receives its own row, never draws itself.
  const own = await a.page.evaluate(() => window.__bc?.remotePlayers?.poses() ?? {});
  expect(Object.keys(own)).not.toContain(characterId);

  // B never had a character: it never wrote.
  expect(b.sends()).toBe(0);

  await a.page.context().close();
  await b.page.context().close();
});
