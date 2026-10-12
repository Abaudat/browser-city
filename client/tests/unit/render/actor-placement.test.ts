// Story 4.5 amendment (FR120-FR122, FR124, FR182, FR139): a remote player is
// an actor like the local player and the commuter -- it lands at the same
// screen pixel at the same pose, in the stack of its own floor, with the
// visibility the viewer's floor gives it. Property over every flight of the
// street fixture, enumerated from the fixture's own flight list.
import { describe, expect, it } from "vitest";
import {
  type ActorPose,
  type FlightOffsetPx,
  type PlacementDims,
  placeActorAt,
} from "../../../src/render/actor-placement";
import { worldPointPx } from "../../../src/render/screen-position";
import { computeVisibility } from "../../../src/render/visibility";
import { buildCharacterDrawable, REMOTE_STABLE_ID_BASE } from "../../../src/test-street/drawables";
import { STREET_FLOOR, SUBWAY_FLOOR } from "../../../src/test-street/fixture";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import {
  committedDefs,
  streetFlightIndex,
  streetFlightList,
  streetMovementConfig,
  streetTransitionIndex,
  streetWorldIndex,
} from "../test-street/street-world";

const TICK_MS = 16;
const config = streetMovementConfig();
const index = streetFlightIndex();
const flights = streetFlightList();
const world = streetWorldIndex();
const transitions = streetTransitionIndex();
const dims: PlacementDims = {
  tileSizePx: 16,
  storeyHeightPx:
    committedDefs().balance.find((b) => b.key === "render.storey_height_px")?.value ?? 0,
  zoom: 3,
};
const realOffset: FlightOffsetPx = (x, y, floor) => index.offsetPx(x, y, floor);

/** The local player's drawn point: the plain projection with the flight's offset. */
function localDrawnPoint(pose: ActorPose) {
  return worldPointPx(
    pose.x,
    pose.y,
    pose.floor,
    dims.tileSizePx,
    dims.storeyHeightPx,
    dims.zoom,
    index.offsetPx(pose.x, pose.y, pose.floor),
  );
}

/** A remote player's drawn point: the shared placement, as `scene.ts` calls it. */
const remoteDrawnPoint = (pose: ActorPose, offsetOf: FlightOffsetPx = realOffset) =>
  placeActorAt(offsetOf, pose, undefined, dims).point;

type Flight = (typeof flights)[number];

/** Poses of a real walk along `flight` from just inside its open edge,
 * through the floor change, and a few ticks past it. */
function walkAlong(flight: Flight): ActorPose[] {
  const openS =
    flight.dirX !== 0
      ? flight.dirX > 0
        ? flight.x0
        : -flight.x1
      : flight.dirY > 0
        ? flight.y0
        : -flight.y1;
  const s = openS + 0.3;
  const startX = flight.dirX !== 0 ? s * flight.dirX : (flight.x0 + flight.x1) / 2;
  const startY = flight.dirY !== 0 ? s * flight.dirY : (flight.y0 + flight.y1) / 2;
  let state = { ...initialFloorWalkState(startX, startY, flight.floor), transitioned: false };
  const out: ActorPose[] = [{ x: state.x, y: state.y, floor: state.floor }];
  let after = 0;
  for (let i = 0; i < 4000 && after < 20; i++) {
    state = stepAndTransition(
      state,
      { x: flight.dirX, y: flight.dirY },
      TICK_MS,
      world,
      config,
      transitions,
      index,
    );
    out.push({ x: state.x, y: state.y, floor: state.floor });
    if (state.floor !== flight.floor) after++;
  }
  return out;
}

const named = (f: Flight) => `the flight at (${f.x0}, ${f.y0}) on floor ${f.floor}`;

describe("a remote player is placed exactly as the local player (FR124, FR182)", () => {
  it("has flights to walk", () => {
    expect(flights.length).toBeGreaterThan(0);
  });

  it("inv_remote_drawn_point_equals_local_drawn_point: on every flight, across its floor change, every tick", () => {
    for (const flight of flights) {
      const poses = walkAlong(flight);
      expect(
        poses.some((p) => p.floor !== flight.floor),
        `the walk along ${named(flight)} never changed floor`,
      ).toBe(true);
      let nonZero = 0;
      for (const pose of poses) {
        expect(remoteDrawnPoint(pose)).toEqual(localDrawnPoint(pose));
        if (index.offsetPx(pose.x, pose.y, pose.floor) !== 0) nonZero++;
      }
      expect(nonZero, `no sampled pose of ${named(flight)} has a non-zero offset`).toBeGreaterThan(
        0,
      );
    }
  });

  it("a remote path with a literal zero offset fails on at least one flight (negative control)", () => {
    const flat: FlightOffsetPx = () => 0;
    const failing = flights.filter((flight) =>
      walkAlong(flight).some((pose) => {
        const drawn = remoteDrawnPoint(pose, flat);
        const local = localDrawnPoint(pose);
        return drawn.x !== local.x || drawn.y !== local.y;
      }),
    );
    expect(failing.length).toBeGreaterThan(0);
  });
});

describe("which stack and which visibility a remote pose goes to (FR120-FR122)", () => {
  it("is the stack of pose.floor, and a floor change names the stack it leaves", () => {
    const first = placeActorAt(realOffset, { x: 3, y: 3, floor: 0 }, undefined, dims);
    expect(first.stackFloor).toBe(0);
    expect(first.leavesFloor).toBeUndefined();
    const same = placeActorAt(realOffset, { x: 4, y: 3, floor: 0 }, 0, dims);
    expect(same.leavesFloor).toBeUndefined();
    const moved = placeActorAt(realOffset, { x: 4, y: 3, floor: 1 }, 0, dims);
    expect(moved.stackFloor).toBe(1);
    expect(moved.leavesFloor).toBe(0);
  });

  it("mid-walk, the remote leaves the old floor's stack on exactly the frame the floor changes", () => {
    for (const flight of flights) {
      let previous: number | undefined;
      let leaves = 0;
      for (const pose of walkAlong(flight)) {
        const placed = placeActorAt(realOffset, pose, previous, dims);
        expect(placed.stackFloor).toBe(pose.floor);
        if (placed.leavesFloor !== undefined) {
          leaves++;
          expect(placed.leavesFloor).toBe(previous);
        }
        previous = pose.floor;
      }
      expect(leaves, named(flight)).toBe(1);
    }
  });

  it("a remote on the street is culled for a viewer in the subway", () => {
    const remote = buildCharacterDrawable(0, 5, 5, STREET_FLOOR, REMOTE_STABLE_ID_BASE, "remote");
    expect(computeVisibility({ floor: SUBWAY_FLOOR, buildingId: 0n }, remote)).toBe("hidden");
    expect(computeVisibility({ floor: STREET_FLOOR, buildingId: 0n }, remote)).not.toBe("hidden");
  });

  it("with both on the same upper floor the remote is visible as any actor there is", () => {
    const remote = buildCharacterDrawable(0, 5, 5, 1, REMOTE_STABLE_ID_BASE, "remote");
    const other = buildCharacterDrawable(0, 6, 5, 1, 1001n, "commuter");
    const viewer = { floor: 1, buildingId: 0n };
    expect(computeVisibility(viewer, remote)).toBe(computeVisibility(viewer, other));
    expect(computeVisibility(viewer, remote)).not.toBe("hidden");
  });
});
