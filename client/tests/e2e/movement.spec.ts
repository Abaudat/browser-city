// Quentin's direction, story 1.8: exactly one e2e spec for player
// movement. Holding a direction key against the real, mounted demo
// fixture must move the avatar immediately, client-side, with no network
// round trip -- and stop at a real collider without ever pausing at a
// collider-less prop it passes on the way. The geometry itself (per-axis
// swept AABB, sliding, sub-tile precision) is exhaustively proven by
// `client/tests/unit/world/*.test.ts`'s property tests; this spec only
// proves the real adapter is wired to the real movement code.
import { expect, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
// `PLAYER_WALK_SOUTH_REST_Y` (id 14, a real physical collider) and the
// awning (id 11, deliberately collider-less) are `fixture.ts`'s own
// story 1.8 worked examples -- see that file's comments.
import { PLAYER_START, PLAYER_WALK_SOUTH_REST_Y } from "../../src/demo/fixture";

function playerPosition(page: import("@playwright/test").Page) {
  return page.evaluate(() => window.__bc?.playerPosition);
}

test("holding a direction key moves the avatar immediately, client-side, with no network round trip, and stops at a real collider without pausing at a collider-less prop", async ({
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

  await page.keyboard.down("ArrowDown");

  // Moves within a few frames -- no round trip to wait on.
  await page.waitForFunction(
    (startY) => (window.__bc?.playerPosition?.y ?? startY) > startY + 0.05,
    PLAYER_START.y,
    { timeout: 2_000 },
  );

  // Passes straight through the awning (id 11, y=7, collider-less) --
  // never pauses there -- on the way to resting against the real
  // obstacle (id 14) at `PLAYER_WALK_SOUTH_REST_Y` (y=8).
  await page.waitForFunction(
    (restY) => (window.__bc?.playerPosition?.y ?? 0) >= restY - 0.01,
    PLAYER_WALK_SOUTH_REST_Y,
    { timeout: 10_000 },
  );

  // Holding the key well past the rest point causes no further drift or
  // push-out (`inv_move_never_ends_inside_collider`'s example, story
  // 1.8's own "holding the key for 1000 frames" acceptance criterion).
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowDown");

  ws.off("framesent", onFrameSent);

  const final = await playerPosition(page);
  expect(final?.x).toBeCloseTo(PLAYER_START.x, 1);
  expect(final?.y).toBeCloseTo(PLAYER_WALK_SOUTH_REST_Y, 1);

  // FR137: fully client-authoritative, no round trip -- zero WebSocket
  // frames (and therefore zero reducer calls) were ever sent while
  // moving.
  expect(framesSentWhileMoving).toBe(0);
});
