// The one implementation of the real-keyboard walk every e2e spec shares.
import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import type { StreetWalkSegment } from "../../src/test-street/fixture";

/** Holds a segment's own key through real, OS-level `page.keyboard` input
 * until its own `until` is met against the real, live `window.__bc`
 * state, then releases -- the exact same `StreetWalkSegment` shape and
 * release conditions `streetWalkRoute` declares once and
 * `street-conformance.test.ts` already proves collision-feasible under
 * real release lag, never a second, hand-rolled "east then south"
 * sequence of this spec's own that could quietly drift from it (story
 * 15.2, cycle 2, Quentin's finding 3: the lamppost's own approach is a
 * waypoint now, not a rest, so a shorter, two-step version of this same
 * walk risks missing the lamppost's own real collider on a slow round
 * trip -- `streetWalkRoute`'s own extra segments around it are exactly
 * what already survive that, proven at unit level). */
export async function walkRealSegment(page: Page, segment: StreetWalkSegment): Promise<void> {
  // Released inside the page on the frame the condition is first met, never
  // after a Node round trip (`test-street.spec.ts`'s own `walkSegment` doc
  // comment says why: a slow runner's round trip overshoots the lamppost's
  // own approach waypoint).
  await page.keyboard.down(segment.key);
  try {
    await page.evaluate(
      ({ until, code, timeoutMs }) =>
        new Promise<void>((resolve, reject) => {
          const met = (u: StreetWalkSegment["until"]): boolean => {
            const pos = window.__bc?.playerPosition;
            const floor = window.__bc?.playerFloor;
            if (!pos || floor === undefined) return false;
            switch (u.kind) {
              case "x-at-least":
                return pos.x >= u.value;
              case "x-at-most":
                return pos.x <= u.value;
              case "y-at-least":
                return pos.y >= u.value;
              case "y-at-most":
                return pos.y <= u.value;
              case "floor":
                return floor === u.value;
              case "cell":
                return Math.floor(pos.x) === u.x && Math.floor(pos.y) === u.y;
            }
          };
          const deadline = performance.now() + timeoutMs;
          const tick = (): void => {
            if (met(until)) {
              window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
              resolve();
              return;
            }
            if (performance.now() >= deadline) {
              reject(new Error(`walkRealSegment: ${JSON.stringify(until)} never met`));
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { until: segment.until, code: segment.key, timeoutMs: 15_000 },
    );
  } finally {
    await page.keyboard.up(segment.key);
  }
}
