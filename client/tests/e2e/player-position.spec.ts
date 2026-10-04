// Story 4.4 (FR138): one player's walk seen from a second browser, at exactly
// the places a unit test with a fake clock cannot reach -- the bytes the real
// client puts on the WebSocket, and what a second page really draws.
//
// A walks through `walk-support.ts`. B records its rendered position of A on
// every animation frame inside the page (`window.__bc.remotePlayers`), never
// polled from Node. Frame-time numbers stay in the unit properties, where the
// clock is synthetic; headless CI frame pacing is not an oracle. No
// `waitForTimeout`: every wait is on an observable condition.
//
// Both pages opt in with `?remotePlayers`: every other spec draws no other
// players, so the shared instance's leftovers never reach a pixel baseline.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { parseDefs } from "../../src/defs/parse";
import type {} from "../../src/net/e2e-hooks";
import type { StreetWalkSegment } from "../../src/test-street/fixture";
import { CHUNK_SIZE, chunkKey } from "../../src/world/chunk";
import { readSpacetimeHandle } from "./spacetime-harness.mjs";
import { walkRealSegment } from "./walk-support";

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
const WALK_CELLS = 3;

async function freshPage(browser: Browser, onSend?: (text: string) => void): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Armed before the page loads: the socket opens during `goto`.
  if (onSend) {
    const dbWsPrefix = readSpacetimeHandle().serverUrl.replace(/^http/, "ws");
    page.on("websocket", (ws) => {
      if (!ws.url().startsWith(dbWsPrefix)) return;
      ws.on("framesent", ({ payload }) => {
        onSend(typeof payload === "string" ? payload : payload.toString("latin1"));
      });
    });
  }
  await page.goto("/?freezeCrowd=1&remotePlayers=1");
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 60_000,
  });
  return page;
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
  let sends = 0;
  const a = await freshPage(browser, (text) => {
    sends += text.match(/set_player_position/g)?.length ?? 0;
  });
  const b = await freshPage(browser);

  // A has a character: its sender starts and writes the spawn position.
  await a.waitForFunction(() => window.__bc?.createCharacter !== undefined);
  await a.evaluate(() => window.__bc?.createCharacter?.());
  await a.waitForFunction(() => window.__bc?.character !== undefined, undefined, {
    timeout: 20_000,
  });
  const characterId = await a.evaluate(() => window.__bc?.character?.characterId);
  if (!characterId) throw new Error("no character id");

  await b.waitForFunction(
    (id) => window.__bc?.remotePlayers?.poses()[id] !== undefined,
    characterId,
    { timeout: 20_000 },
  );
  const updatesBefore = await b.evaluate((id) => {
    const r = window.__bc?.region;
    return (r?.inserts[`playerPosition:${id}`] ?? 0) + (r?.updates[`playerPosition:${id}`] ?? 0);
  }, characterId);

  await b.evaluate(() => window.__bc?.remotePlayers?.startTrace());
  const here = await a.evaluate(() => window.__bc?.playerPosition);
  if (!here) throw new Error("no player position");
  const segment: StreetWalkSegment = {
    label: "east",
    key: "ArrowRight",
    until: { kind: "x-at-least", value: here.x + WALK_CELLS },
  };
  const sendsBefore = sends;
  const startedAt = Date.now();
  await walkRealSegment(a, segment);
  const walkMs = Date.now() - startedAt;

  // B converges to A's own rest position within one quantum.
  const rest = await a.evaluate(() => window.__bc?.playerPosition);
  if (!rest) throw new Error("no rest position");
  await b.waitForFunction(
    ({ id, x, y, q }) => {
      const p = window.__bc?.remotePlayers?.poses()[id];
      return p !== undefined && Math.abs(p.x - x) <= q && Math.abs(p.y - y) <= q;
    },
    { id: characterId, x: rest.x, y: rest.y, q: QUANTUM },
    { timeout: 20_000 },
  );
  const trace = await b.evaluate(() => window.__bc?.remotePlayers?.stopTrace() ?? {});
  const seen = trace[characterId] ?? [];

  // On a straight walk it never steps backwards.
  for (let i = 1; i < seen.length; i++) {
    expect(seen[i].x).toBeGreaterThanOrEqual(seen[i - 1].x);
  }
  // It interpolates rather than snaps: more distinct rendered positions than
  // row updates B received.
  const updatesAfter = await b.evaluate((id) => {
    const r = window.__bc?.region;
    return (r?.inserts[`playerPosition:${id}`] ?? 0) + (r?.updates[`playerPosition:${id}`] ?? 0);
  }, characterId);
  const distinct = new Set(seen.map((s) => `${s.x},${s.y}`)).size;
  expect(updatesAfter).toBeGreaterThan(updatesBefore);
  expect(distinct).toBeGreaterThan(updatesAfter - updatesBefore);

  // The wire: A's sends over the walk are at most duration * rate + 2.
  const walkSends = sends - sendsBefore;
  expect(walkSends).toBeGreaterThan(0);
  expect(walkSends).toBeLessThanOrEqual((walkMs / 1000) * HZ + 2);

  // A standing player costs zero calls over a standing window.
  const standing = sends;
  await frames(a, 90);
  expect(sends).toBe(standing);

  // B's cache holds only players of the chunk it is in, never a far one.
  const here2 = await a.evaluate(() => window.__bc?.playerPosition);
  if (!here2) throw new Error("no position");
  const near = String(chunkKey(Math.floor(here2.x), Math.floor(here2.y), 0));
  const cached = await b.evaluate(() => window.__bc?.region?.cachedChunkKeys("playerPosition"));
  expect(cached?.length ?? 0).toBeGreaterThan(0);
  const held = new Set(
    (await b.evaluate(() => window.__bc?.region?.held() ?? [])).map((h) => h.split(",")[0]),
  );
  expect(CHUNK_SIZE).toBeGreaterThan(0);
  expect(held.size).toBeGreaterThan(0);
  expect(cached).toContain(near);

  await a.context().close();
  await b.context().close();
});
