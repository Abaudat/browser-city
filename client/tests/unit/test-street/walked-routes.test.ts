// Every route an e2e spec walks, proven feasible by the unit model: it
// completes at no release lag and at `RELEASE_LAG`, and no segment starts
// with its own axis threshold already holding.
import { describe, expect, it } from "vitest";
import { PLAYER_START, RELEASE_LAG, streetWalkUntilMet } from "../../../src/test-street/fixture";
import { initialFloorWalkState } from "../../../src/world/floor-walk";
import { simulateStreetWalk, walkedRoutes } from "./street-world";

describe("every walked route", () => {
  const routes = walkedRoutes();

  it("registers the routes the specs walk", () => {
    expect(routes.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "street-walk",
        "subway-approach",
        "near-railing-press",
        "bollard",
        "bridge-lap",
        "bin-reach",
        "railing-foot",
      ]),
    );
  });

  for (const route of routes) {
    for (const [lagName, lag] of [
      ["no lag", { releaseLagSteps: 0 }],
      ["RELEASE_LAG", RELEASE_LAG],
    ] as const) {
      it(`${route.name} completes at ${lagName}, no segment starting already released`, () => {
        const start = route.start();
        let state = start ?? {
          ...initialFloorWalkState(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor),
          transitioned: false,
        };
        for (const segment of route.segments) {
          const kind = segment.until.kind;
          if (kind !== "floor" && kind !== "cell") {
            expect(
              streetWalkUntilMet(segment.until, state.x, state.y, state.floor),
              `${route.name}/${segment.label} starts with ${JSON.stringify(segment.until)} already holding`,
            ).toBe(false);
          }
          const out = simulateStreetWalk([segment], { ...lag, start: state });
          const end = out[0]?.state;
          if (!end) throw new Error(`${route.name}/${segment.label} produced no checkpoint`);
          state = end;
        }
      });
    }
  }
});
