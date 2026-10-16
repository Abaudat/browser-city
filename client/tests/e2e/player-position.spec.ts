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
import type { Browser, Page } from "@playwright/test";
import { parseDefs } from "../../src/defs/parse";
import type {} from "../../src/net/e2e-hooks";
import { CHUNK_SIZE } from "../../src/world/chunk";
import { REGION_LEAVE_RADIUS_CHUNKS, REGION_RADIUS_CHUNKS } from "../../src/world/region";
import {
  BRIDGE_FLIGHT_X0,
  BRIDGE_FLOOR,
  BRIDGE_FOOT_Y,
  BRIDGE_X0,
  STREET_FLOOR,
} from "../unit/support/stairs-world";
import { standInBlock } from "./block-support";
import { walkFreeCells } from "./district-support";
import { expect, test } from "./fixtures";
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
const WALK_CELLS = 2.5;
/** The one floor the generated city has. */
const GROUND_FLOOR = 0;

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
  await page.goto("/?freezeBodies=1&remotePlayers=1");
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

/** Gives `page` a character and returns its id. */
async function createCharacter(page: Page): Promise<string> {
  await page.waitForFunction(() => window.__bc?.createCharacter !== undefined);
  await page.evaluate(() => window.__bc?.createCharacter?.());
  await page.waitForFunction(() => window.__bc?.character !== undefined, undefined, {
    timeout: 20_000,
  });
  const id = await page.evaluate(() => window.__bc?.character?.characterId);
  if (!id) throw new Error("no character id");
  return id;
}

// These specs own when a character exists, so none arrives by itself.
test.use({ arrive: false });

/** Waits until `viewer` draws `id` where `walker`'s own scene stands: a
 * new character's server row is its flat's spawn until its sender's first
 * send, and a trace started before that would record the jump. */
async function drawnWhereItStands(viewer: Page, walker: Page, id: string): Promise<void> {
  const at = await walker.evaluate(() => window.__bc?.playerPosition);
  if (!at) throw new Error("no position");
  await viewer.waitForFunction(
    ({ cid, x, y, q }) => {
      const p = window.__bc?.remotePlayers?.poses()[cid];
      return p !== undefined && Math.abs(p.x - x) <= q && Math.abs(p.y - y) <= q;
    },
    { cid: id, x: at.x, y: at.y, q: QUANTUM },
    { timeout: 20_000 },
  );
}

/** The axis a straight walk travelled most along, from the received samples. */
function walkedAxis(samples: readonly { x: number; y: number }[]): "x" | "y" {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return "x";
  return Math.abs(last.x - first.x) >= Math.abs(last.y - first.y) ? "x" : "y";
}

/** Never changes direction: non-decreasing or non-increasing throughout. */
function isMonotonic(values: readonly number[]): boolean {
  const up = values.every((v, i) => i === 0 || v >= (values[i - 1] ?? v));
  const down = values.every((v, i) => i === 0 || v <= (values[i - 1] ?? v));
  return up || down;
}

test("a walk is drawn smoothly on a second page, sent at the dial's rate, and a standing player costs nothing", async ({
  browser,
}) => {
  // Two walks, one each way, on two pages: over the 30 s default on a CI runner.
  test.setTimeout(120_000);
  const a = await countedPage(browser);
  const b = await countedPage(browser);
  await b.page.bringToFront();

  // A page with no character puts no position write on the wire, walking or
  // not: every deployed visitor is in this state, and a refused call is
  // uncounted by the `position` class, so only the wire can show it.
  // (The body is not driveable before a name either, story 4.6: nothing
  // here can walk, and the wire stays silent.)
  await frames(a.page, 90);
  expect(a.sends()).toBe(0);

  // A has a character: its sender starts and writes the spawn position.
  const characterId = await createCharacter(a.page);

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
  await drawnWhereItStands(b.page, a.page, characterId);
  const updatesBefore = await rowUpdates(characterId);

  await b.page.evaluate(() => window.__bc?.remotePlayers?.startTrace());
  const sendsBefore = a.sends();
  const startedAt = Date.now();
  await walkFreeCells(a.page, "walk", WALK_CELLS);
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

  // On a straight walk it never steps backwards, along whichever axis the
  // walk took (the player walks wherever the district leaves room).
  const axis = walkedAxis(received);
  expect(isMonotonic(drawn.map((f) => f[axis])), "drawn positions stepped backwards").toBe(true);
  // It interpolates rather than snaps: at least one drawn position lies
  // strictly between two consecutive samples B received. Holds at any frame
  // pacing that draws a frame while a segment is being walked.
  const between = drawn.some((f) =>
    received.some((s, i) => {
      const next = received[i + 1];
      if (next === undefined) return false;
      const [lo, hi] = [Math.min(s[axis], next[axis]), Math.max(s[axis], next[axis])];
      return lo < f[axis] && f[axis] < hi;
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

  // B never had a character until now: it never wrote.
  expect(b.sends()).toBe(0);

  // The other way round (FR138 both ways): B takes a character, walks, and A
  // draws B moving between the samples it received.
  const bId = await createCharacter(b.page);
  await a.page.bringToFront();
  await a.page.waitForFunction((id) => window.__bc?.remotePlayers?.poses()[id] !== undefined, bId, {
    timeout: 20_000,
  });
  await drawnWhereItStands(a.page, b.page, bId);
  await a.page.evaluate(() => window.__bc?.remotePlayers?.startTrace());
  await walkFreeCells(b.page, "walk-b", WALK_CELLS);
  const bRest = await b.page.evaluate(() => window.__bc?.playerPosition);
  if (!bRest) throw new Error("no rest position for B");
  await a.page.waitForFunction(
    ({ id, x, y, q }) => {
      const p = window.__bc?.remotePlayers?.poses()[id];
      return p !== undefined && Math.abs(p.x - x) <= q && Math.abs(p.y - y) <= q;
    },
    { id: bId, x: bRest.x, y: bRest.y, q: QUANTUM },
    { timeout: 20_000 },
  );
  const seen = await a.page.evaluate(
    () => window.__bc?.remotePlayers?.stopTrace() ?? { frames: {}, samples: {} },
  );
  const bDrawn = seen.frames[bId] ?? [];
  expect(bDrawn.length, "A drew nothing of B").toBeGreaterThan(0);
  const bAxis = walkedAxis(seen.samples[bId] ?? []);
  expect(isMonotonic(bDrawn.map((f) => f[bAxis])), "B's drawn positions stepped backwards").toBe(
    true,
  );

  // Lazy despawn (AC2), through the real handle release: with B's region
  // centred where A's column is inside the leave radius but outside the enter
  // radius, A is still drawn; one column past the leave radius A is gone; back
  // inside the enter radius A is drawn again. No timer, no viewport test.
  const aRest = await a.page.evaluate(() => window.__bc?.playerPosition);
  if (!aRest) throw new Error("no rest position for A");
  const aColumn = Math.floor(aRest.x / CHUNK_SIZE);
  const centreAt = (columns: number) => (aColumn + columns) * CHUNK_SIZE + 1;
  const regionAt = (page: Page, x: number) =>
    page.evaluate(([cx, cy, floor]) => window.__bc?.region?.moveTo(cx, cy, floor), [
      x,
      aRest.y,
      GROUND_FLOOR,
    ] as [number, number, number]);
  const drawnByB = (cid: string) =>
    b.page.evaluate((id) => window.__bc?.remotePlayers?.poses()[id] !== undefined, cid);
  await b.page.bringToFront();
  await regionAt(b.page, centreAt(REGION_LEAVE_RADIUS_CHUNKS));
  expect(REGION_LEAVE_RADIUS_CHUNKS).toBeGreaterThan(REGION_RADIUS_CHUNKS);
  for (let i = 0; i < 6; i++) {
    await frames(b.page, 10);
    expect(await drawnByB(characterId), "A vanished inside the keep radius").toBe(true);
  }
  await regionAt(b.page, centreAt(REGION_LEAVE_RADIUS_CHUNKS + 1));
  await b.page.waitForFunction(
    (cid) => window.__bc?.remotePlayers?.poses()[cid] === undefined,
    characterId,
    { timeout: 20_000 },
  );
  await regionAt(b.page, centreAt(0));
  await b.page.waitForFunction(
    (cid) => window.__bc?.remotePlayers?.poses()[cid] !== undefined,
    characterId,
    { timeout: 20_000 },
  );

  // A player who has left is still drawn where they stopped: the row is never
  // deleted, there is no presence. A's page closes; B keeps drawing A at its
  // rest position well past the interpolation delay and the sender period.
  await b.page.waitForFunction(
    ({ id, x, y, q }) => {
      const p = window.__bc?.remotePlayers?.poses()[id];
      return p !== undefined && Math.abs(p.x - x) <= q && Math.abs(p.y - y) <= q;
    },
    { id: characterId, x: aRest.x, y: aRest.y, q: QUANTUM },
    { timeout: 20_000 },
  );
  const before = await b.page.evaluate(
    (cid) => window.__bc?.remotePlayers?.drawn()[cid],
    characterId,
  );
  await a.page.context().close();
  // About 2.5 s of the page's own frames: past the delay and the period.
  await frames(b.page, 150);
  const after = await b.page.evaluate(
    (cid) => ({
      pose: window.__bc?.remotePlayers?.poses()[cid],
      drawn: window.__bc?.remotePlayers?.drawn()[cid],
    }),
    characterId,
  );
  expect(after.pose, "B stopped drawing A after A left").toBeDefined();
  expect(Math.abs((after.pose?.x ?? 0) - aRest.x)).toBeLessThanOrEqual(QUANTUM);
  expect(Math.abs((after.pose?.y ?? 0) - aRest.y)).toBeLessThanOrEqual(QUANTUM);
  expect(after.drawn?.visible).toBe(true);
  expect(after.drawn?.screenX).toBe(before?.screenX);
  expect(after.drawn?.screenY).toBe(before?.screenY);

  await b.page.context().close();
});

test("a player on the footbridge deck is drawn on floor 1, in the deck's stack, where they draw themselves (FR120-FR122, FR124)", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const a = await countedPage(browser);
  const b = await countedPage(browser);
  const id = await createCharacter(a.page);
  await b.page.bringToFront();
  await b.page.waitForFunction(
    (cid) => window.__bc?.remotePlayers?.poses()[cid] !== undefined,
    id,
    { timeout: 20_000 },
  );
  // Both stand at the fixture block: B must hold the chunks A is in to see
  // A at all, and each is the other's remote.
  await standInBlock(b.page, BRIDGE_FLIGHT_X0 + 0.5, BRIDGE_FOOT_Y + 1.5, STREET_FLOOR);
  // Up the fixture block's footbridge flight and a little along the deck.
  await standInBlock(a.page, BRIDGE_FLIGHT_X0 + 0.5, BRIDGE_FOOT_Y + 0.5, STREET_FLOOR);
  await walkRealSegment(a.page, {
    label: "up-the-flight",
    key: "ArrowUp",
    until: { kind: "floor", value: BRIDGE_FLOOR },
  });
  await walkRealSegment(a.page, {
    label: "along-the-deck",
    key: "ArrowLeft",
    until: { kind: "x-at-most", value: BRIDGE_X0 + 0.5 },
  });
  const rest = await a.page.evaluate(() => window.__bc?.playerPosition);
  if (!rest) throw new Error("no rest position");
  await b.page.waitForFunction(
    ({ cid, x, y, floor, q }) => {
      const p = window.__bc?.remotePlayers?.poses()[cid];
      return (
        p !== undefined && p.floor === floor && Math.abs(p.x - x) <= q && Math.abs(p.y - y) <= q
      );
    },
    { cid: id, x: rest.x, y: rest.y, floor: BRIDGE_FLOOR, q: QUANTUM },
    { timeout: 30_000 },
  );

  const seen = await b.page.evaluate(
    (cid) => ({ drawn: window.__bc?.remotePlayers?.drawn()[cid] }),
    id,
  );
  const own = await a.page.evaluate(() => window.__bc?.playerDrawnPoint?.());
  if (!seen.drawn || !own) throw new Error("nothing drawn to compare");
  expect(seen.drawn.visible, "the remote is hidden on the deck").toBe(true);
  // The sprite's real parent is the deck floor's pool (re-parented on the
  // floor change), not merely listed under it.
  expect(seen.drawn.stackFloor).toBe(BRIDGE_FLOOR);
  expect(Math.abs(seen.drawn.screenX - own.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(seen.drawn.screenY - own.y)).toBeLessThanOrEqual(1);

  await a.page.context().close();
  await b.page.context().close();
});
