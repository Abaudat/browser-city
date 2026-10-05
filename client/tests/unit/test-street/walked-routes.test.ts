// Every route an e2e spec walks, proven feasible by the unit model: it
// completes at no release lag and at `RELEASE_LAG`, and no segment starts
// with its own axis threshold already holding.
import { describe, expect, it } from "vitest";
import { isWithinReach } from "../../../src/input/pick";
import {
  isDefStreetProp,
  PLAYER_START,
  RELEASE_LAG,
  STREET_PROPS,
  streetWalkUntilMet,
  TRASH_BIN_DEF_ID,
} from "../../../src/test-street/fixture";
import { initialFloorWalkState } from "../../../src/world/floor-walk";
import {
  committedDefs,
  simulateStreetWalk,
  streetMovementConfig,
  walkedRoutes,
} from "./street-world";

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
        "flight-walk",
        "footbridge-walk",
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

describe("the bin-reach route", () => {
  it("ends with the player inside the trash bin's reach, at no lag and at RELEASE_LAG", () => {
    const bin = STREET_PROPS.find((p) => isDefStreetProp(p) && p.defId === TRASH_BIN_DEF_ID);
    const def = committedDefs().objects.find((o) => o.id === TRASH_BIN_DEF_ID);
    const route = walkedRoutes().find((r) => r.name === "bin-reach");
    if (!bin || !def || !route) throw new Error("no bin, def or route");
    for (const lag of [{ releaseLagSteps: 0 }, RELEASE_LAG]) {
      const out = simulateStreetWalk(route.segments, lag);
      const end = out[out.length - 1]?.state;
      if (!end) throw new Error("the route produced no checkpoint");
      expect(
        isWithinReach(
          { anchorX: bin.x, anchorY: bin.y },
          def,
          { x: end.x, y: end.y, floor: end.floor },
          bin.floor,
          streetMovementConfig().subcellsPerCell,
        ),
      ).toBe(true);
    }
  });
});
