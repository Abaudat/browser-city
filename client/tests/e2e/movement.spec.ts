// Exactly one e2e spec for player movement. Holding a direction key
// against the real, mounted demo fixture must move the avatar within a
// few animation frames, client-side, with no network round trip -- and
// stop at a real collider without ever pausing at a collider-less prop it
// passes on the way. The geometry itself (per-axis swept AABB, sliding,
// sub-tile precision) is exhaustively proven by
// `client/tests/unit/world/*.test.ts`'s property tests; this spec only
// proves the real adapter is wired to the real movement code.
import { expect, test } from "@playwright/test";
import { PLAYER_START } from "../../src/demo/fixture";
import type {} from "../../src/net/e2e-hooks";
// The rest point is the lamppost's own base collider (fixture id 14,
// placed by its real `defs/objects` id); the awning (id 11) is
// deliberately collider-less. Both come from `defs/`, never a number
// restated here.
import { lamppostRestY } from "../unit/demo/demo-world";

function playerPosition(page: import("@playwright/test").Page) {
  return page.evaluate(() => window.__bc?.playerPosition);
}

test("holding a direction key moves the avatar within a few frames, client-side, with no network round trip, and stops at a real collider without pausing at a collider-less prop", async ({
  page,
}) => {
  const wsPromise = page.waitForEvent("websocket");
  await page.goto("/");
  const ws = await wsPromise;

  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 10_000,
  });

  const initial = await playerPosition(page);
  expect(initial).toEqual({ x: PLAYER_START.x, y: PLAYER_START.y });

  let framesSentWhileMoving = 0;
  const onFrameSent = (): void => {
    framesSentWhileMoving++;
  };
  ws.on("framesent", onFrameSent);

  // "Immediately, with no round trip" measured in animation frames, not
  // wall-clock: a server echo would take far more than three frames even
  // on localhost, so a time-based wait could never tell the two apart.
  //
  // The count is anchored inside the page, on its own `keydown` event --
  // never on the `page.evaluate` that installs the probe. Those are two
  // separate CDP round trips, and every frame that renders between them
  // would otherwise be charged to the movement.
  await page.evaluate((startY) => {
    const probe = { framesSinceKeydown: null as number | null, movedAt: null as number | null };
    (window as unknown as { __bcFrames: typeof probe }).__bcFrames = probe;
    window.addEventListener("keydown", () => {
      probe.framesSinceKeydown ??= 0;
    });
    const tick = (): void => {
      if (probe.framesSinceKeydown !== null && probe.movedAt === null) {
        probe.framesSinceKeydown++;
        if ((window.__bc?.playerPosition?.y ?? startY) > startY) {
          probe.movedAt = probe.framesSinceKeydown;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, PLAYER_START.y);

  await page.keyboard.down("ArrowDown");

  await page.waitForFunction(
    () =>
      (window as unknown as { __bcFrames?: { movedAt: number | null } }).__bcFrames?.movedAt !==
      null,
    undefined,
    { timeout: 5_000 },
  );
  const movedAtFrame = await page.evaluate(
    () =>
      (window as unknown as { __bcFrames?: { movedAt: number | null } }).__bcFrames?.movedAt ??
      Number.NaN,
  );
  // One frame for the scene's own ticker to run after the keydown, plus
  // one for the probe's callback possibly running ahead of it on that
  // same frame. Anything beyond that is a round trip, not a frame.
  expect(movedAtFrame).toBeLessThanOrEqual(2);

  // Passes straight through the awning (id 11, y=7, collider-less) --
  // never pauses there -- on the way to resting against the lamppost's
  // own base collider.
  const restY = lamppostRestY();
  await page.waitForFunction(
    (expected) => (window.__bc?.playerPosition?.y ?? 0) >= expected - 0.01,
    restY,
    { timeout: 10_000 },
  );

  // Holding the key well past the rest point causes no further drift or
  // push-out.
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowDown");

  ws.off("framesent", onFrameSent);

  const final = await playerPosition(page);
  expect(final?.x).toBeCloseTo(PLAYER_START.x, 5);
  expect(final?.y).toBeCloseTo(restY, 5);

  // FR137: fully client-authoritative, no round trip -- zero WebSocket
  // frames (and therefore zero reducer calls) were ever sent while
  // moving.
  expect(framesSentWhileMoving).toBe(0);
});
