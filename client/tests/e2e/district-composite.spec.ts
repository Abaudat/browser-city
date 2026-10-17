// Story 3.16: what the hand-laid street's one long walk used to hold
// together, on the generated city: one walk out of the arrival dwelling onto
// its street, with real key presses, asserting through `window.__bc`:
//   - FR137: holding a key moves the avatar within a few animation frames of
//     the browser's own keydown, and the walk sends nothing but the position
//     sender's frames, at the dial's rate;
//   - FR120/FR121: inside, the building's front walls are retracted; out on
//     the street they are drawn again and every window is a solid object in
//     its wall (opaque on a front, hidden on a far side);
//   - FR123: the mounted pool order of the building's drawables is the order
//     the comparator demands for where the player stands;
//   - FR61: the avatar is the same five parts after the walk and a reload;
//   - FR121: no mask, filter or render texture exists in the real display
//     list.

import type { Page } from "@playwright/test";
import { buildLayerRankTable, resolveRank } from "../../src/render/layer-ranks";
import { FIRST_POOL_RANK, LAYER_TABLE, layerCodeByName } from "../../src/render/layer-table";
import {
  buildCharacterDrawable,
  buildPropDrawables,
  type PlacedRowView,
} from "../../src/render/prop-drawables";
import { compareDrawables } from "../../src/render/sort-key";
import {
  committedDefs,
  committedObjectSources,
  committedThresholdDefIds,
  committedWindowDefIds,
} from "../unit/support/committed-defs";
import { districtWorld } from "../unit/support/district-fixture";
import {
  arrivalCell,
  awaitScene,
  buildingOf,
  district,
  nearestCell,
  walkTo,
} from "./district-support";
import { expect, test } from "./fixtures";
import { walkRealSegment } from "./walk-support";

test.use({ viewport: { width: 1920, height: 1080 } });

const STUB_ID_OFFSET = 500_000_000_000n;
const WALLS_LAYER = layerCodeByName("walls");
const RANKS = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));
const rankOf = (code: number) => resolveRank(RANKS, code);

/** Every pool id the mounted display list should hold for the dump rows
 * inside `rect`, in the order the comparator demands with the player at
 * `(x, y)`. */
function expectedOrder(
  rect: { x0: number; y0: number; x1: number; y1: number },
  player: { x: number; y: number; floor: number },
): string[] {
  const { ownership } = districtWorld();
  const rows: PlacedRowView[] = district.objects
    .filter((o) => o.x >= rect.x0 && o.x < rect.x1 && o.y >= rect.y0 && o.y < rect.y1)
    .filter((o) => o.layer !== layerCodeByName("ground"))
    .map((o) => ({
      objectId: o.objectId,
      defId: o.defId,
      x: o.x,
      y: o.y,
      floor: o.floor,
      layer: o.layer,
    }));
  const drawables = buildPropDrawables(rows, {
    rankOf,
    ownership,
    windowDefIds: committedWindowDefIds(),
    thresholdDefIds: committedThresholdDefIds(),
    wallStubDefId: committedDefs().balance.find((b) => b.key === "render.wall_stub_object_id")
      ?.value as number,
    objectDefs: committedObjectSources(),
  });
  const body = buildCharacterDrawable(
    rankOf(layerCodeByName("characters")),
    player.x,
    player.y,
    player.floor,
  );
  return [...drawables, body]
    .filter((d) => d.rank >= FIRST_POOL_RANK)
    .sort(compareDrawables)
    .map((d) => d.stableId.toString());
}

/** Holds `key` for `segment` while counting animation frames from the
 * browser's own keydown to the first frame the position reads moved. */
async function walkMeasuringLatency(
  page: Page,
  segment: Parameters<typeof walkRealSegment>[1],
  from: { x: number; y: number },
): Promise<number> {
  await page.evaluate((start) => {
    const probe = { sinceKeydown: null as number | null, movedAt: null as number | null };
    (window as unknown as { __bcFrames: typeof probe }).__bcFrames = probe;
    window.addEventListener("keydown", () => {
      probe.sinceKeydown ??= 0;
    });
    const tick = (): void => {
      if (probe.sinceKeydown !== null && probe.movedAt === null) {
        probe.sinceKeydown++;
        const p = window.__bc?.playerPosition;
        if (p && (p.x !== start.x || p.y !== start.y)) probe.movedAt = probe.sinceKeydown;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, from);
  await walkRealSegment(page, segment);
  return page.evaluate(
    () =>
      (window as unknown as { __bcFrames?: { movedAt: number | null } }).__bcFrames?.movedAt ??
      Number.NaN,
  );
}

test("one walk out of the arrival dwelling onto its street: latency, retraction, windows, depth order, appearance and the frame budget together", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Data frames on the app's own SpacetimeDB socket (never a control frame,
  // never Vite's HMR socket): found as the one websocket whose origin is not
  // the page's own, wired up before the page loads.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("no baseURL configured for this project");
  const pageOrigin = new URL(baseURL).origin;
  let spacetimeRequestId: string | undefined;
  cdp.on("Network.webSocketCreated", (event: { requestId: string; url: string }) => {
    const origin = new URL(event.url.replace(/^ws/, "http")).origin;
    if (origin !== pageOrigin) spacetimeRequestId = event.requestId;
  });
  let framesSentWhileWalking = 0;
  const onFrameSent = (event: {
    requestId: string;
    response: { opcode: number; payloadData: string };
  }): void => {
    if (event.requestId !== spacetimeRequestId) return;
    if (event.response.opcode === 1 || event.response.opcode === 2) framesSentWhileWalking++;
  };

  await page.goto("/");
  await awaitScene(page);
  const home = arrivalCell();
  const building = buildingOf(home);
  expect(building).not.toBe(0n);
  const appearanceAtStart = await page.evaluate(() => window.__bc?.playerAppearance);
  expect(appearanceAtStart).toBeTruthy();
  await page.waitForFunction(() => Object.keys(window.__bc?.visibility ?? {}).length > 0);

  // --- inside: the front walls are retracted ------------------------------
  const walls = district.objects
    .filter((o) => o.layer === WALLS_LAYER && o.floor === 0)
    .filter((o) => buildingOf({ x: o.x, y: o.y }) === building)
    .filter((o) => buildingOf({ x: o.x, y: o.y + 1 }) !== building)
    .map((o) => o.objectId.toString());
  expect(walls.length).toBeGreaterThan(0);
  const inside = await page.evaluate(() => window.__bc?.visibility ?? {});
  for (const id of walls) expect(inside[id], `wall ${id}`).toBe("hidden");
  expect(inside[(BigInt(walls[0] as string) + STUB_ID_OFFSET).toString()]).toBe("normal");

  // --- out to the street ---------------------------------------------------
  const street = nearestCell(home, false);
  cdp.on("Network.webSocketFrameSent", onFrameSent);
  const startedAt = Date.now();
  const first = await page.evaluate(() => window.__bc?.playerPosition);
  if (!first) throw new Error("no position");
  // FR137: the walk's own first held key, measured against the browser's
  // own keydown (one frame for the ticker, one for the probe running first).
  const dx = street.x + 0.5 - first.x;
  const dy = street.y + 0.5 - first.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const latency = await walkMeasuringLatency(
    page,
    horizontal
      ? {
          label: "first-leg",
          key: dx >= 0 ? "ArrowRight" : "ArrowLeft",
          until:
            dx >= 0
              ? { kind: "x-at-least", value: first.x + Math.min(Math.abs(dx), 1) }
              : { kind: "x-at-most", value: first.x - Math.min(Math.abs(dx), 1) },
        }
      : {
          label: "first-leg",
          key: dy >= 0 ? "ArrowDown" : "ArrowUp",
          until:
            dy >= 0
              ? { kind: "y-at-least", value: first.y + Math.min(Math.abs(dy), 1) }
              : { kind: "y-at-most", value: first.y - Math.min(Math.abs(dy), 1) },
        },
    first,
  );
  expect(latency).toBeLessThanOrEqual(2);
  await walkTo(page, street);
  cdp.off("Network.webSocketFrameSent", onFrameSent);
  const walkMs = Date.now() - startedAt;

  const outside = await page.evaluate(() => ({
    visibility: window.__bc?.visibility ?? {},
    alpha: window.__bc?.visibilityAlpha ?? {},
    at: window.__bc?.playerPosition,
    floor: window.__bc?.playerFloor,
    masks: window.__bc?.masksAllNull,
  }));
  expect(outside.floor).toBe(0);
  expect(outside.masks).toBe(true);
  // The walls are back the moment the player is outside the enclosure.
  for (const id of walls) expect(outside.visibility[id], `wall ${id}`).toBe("normal");

  // Story 3.16 (FR121): seen from the street, a roofed building's window is
  // a solid object in its wall -- opaque on the front, hidden on a far side
  // under the roof; translucency (`render.window_alpha`) is for a viewer
  // inside (`visibility.test.ts`). The nearest window is a long walk away
  // (the crossing speed is `district-walk.spec.ts`'s claim), so the player is
  // stood on the pavement before it with the DEV hook, as the server's start
  // would.
  const windowRows = district.objects.filter(
    (o) => committedWindowDefIds().has(o.defId) && o.floor === 0,
  );
  const nearest = [...windowRows].sort(
    (p, q) =>
      Math.abs(p.x - home.x) +
      Math.abs(p.y - home.y) -
      (Math.abs(q.x - home.x) + Math.abs(q.y - home.y)),
  )[0];
  if (!nearest) throw new Error("the district has no window");
  const pavement = nearestCell({ x: nearest.x, y: nearest.y }, false, 12);
  await page.evaluate(
    ([x, y]) => window.__bc?.teleport?.(x as number, y as number, 0),
    [pavement.x + 0.5, pavement.y + 0.5],
  );
  const windowId = nearest.objectId.toString();
  await page.waitForFunction((id) => window.__bc?.visibility?.[id] !== undefined, windowId, {
    timeout: 30_000,
  });
  const seen = await page.evaluate(() => ({
    visibility: window.__bc?.visibility ?? {},
    alpha: window.__bc?.visibilityAlpha ?? {},
  }));
  const windows = windowRows
    .map((o) => o.objectId.toString())
    .filter((id) => seen.visibility[id] !== undefined);
  expect(windows.length).toBeGreaterThan(0);
  for (const id of windows) {
    expect(["normal", "hidden"], `window ${id}`).toContain(seen.visibility[id]);
    if (seen.visibility[id] === "normal") expect(seen.alpha[id]).toBe(1);
  }
  expect(windows.some((id) => seen.visibility[id] === "normal")).toBe(true);
  // Back where the walk ended, for the order and the frame budget below.
  await page.evaluate(
    ([x, y]) => window.__bc?.teleport?.(x as number, y as number, 0),
    [outside.at?.x ?? 0, outside.at?.y ?? 0],
  );
  await page.waitForFunction((b) => window.__bc?.visibility?.[b] !== undefined, walls[0] as string);

  // FR123: the mounted order of the building's drawables is the
  // comparator's, with the player where they stand.
  const pad = 6;
  const rect = {
    x0: home.x - pad,
    y0: home.y - pad,
    x1: home.x + pad,
    y1: home.y + pad,
  };
  const want = expectedOrder(rect, { x: outside.at?.x ?? 0, y: outside.at?.y ?? 0, floor: 0 });
  const wanted = new Set(want);
  const mounted = (await page.evaluate(() => window.__bc?.renderOrder ?? [])).filter((id) =>
    wanted.has(id),
  );
  expect(mounted.length).toBeGreaterThan(0);
  expect(mounted).toEqual(want.filter((id) => mounted.includes(id)));

  // FR137: the walk sent only the position sender's frames, at the dial's
  // rate -- never one per step.
  const hz = committedDefs().balance.find((b) => b.key === "net.player_position_hz")?.value ?? 0;
  expect(hz).toBeGreaterThan(0);
  expect(framesSentWhileWalking).toBeLessThanOrEqual(Math.ceil((walkMs / 1000) * hz) + 6);

  // FR61: the same five parts after the walk, and after a reload.
  expect(await page.evaluate(() => window.__bc?.playerAppearance)).toEqual(appearanceAtStart);
  await page.reload();
  await awaitScene(page);
  expect(await page.evaluate(() => window.__bc?.playerAppearance)).toEqual(appearanceAtStart);
});
