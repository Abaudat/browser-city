// Where an actor (the local player, the commuter, a remote player) lands on
// screen and in which floor stack, as one pure decision: the pose goes
// through `worldPointPx` with the flight offset its own position and floor
// give (FR124, FR182), and the stack is the one for `pose.floor`. `scene.ts`'s
// `placeActor` is the only caller, so no actor kind has a placement of its own.

import { worldPointPx } from "./screen-position";

/** An actor's feet position, in cells, and the floor it stands on. */
export interface ActorPose {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

/** The draw-only flight offset in screen px at a position (`FlightIndex.offsetPx`). */
export type FlightOffsetPx = (x: number, y: number, floor: number) => number;

export interface PlacementDims {
  readonly tileSizePx: number;
  readonly storeyHeightPx: number;
  readonly zoom: number;
}

export interface ActorPlacement {
  /** The drawn bottom-centre point, whole-pixel snapped. */
  readonly point: { readonly x: number; readonly y: number };
  /** The floor whose stack the sprite belongs to: `pose.floor`. */
  readonly stackFloor: number;
  /** The floor whose stack it must leave this frame; none when it stays. */
  readonly leavesFloor: number | undefined;
}

/** `previousFloor` is the floor the actor was last placed on, if any. */
export function placeActorAt(
  offsetOf: FlightOffsetPx,
  pose: ActorPose,
  previousFloor: number | undefined,
  dims: PlacementDims,
): ActorPlacement {
  const point = worldPointPx(
    pose.x,
    pose.y,
    pose.floor,
    dims.tileSizePx,
    dims.storeyHeightPx,
    dims.zoom,
    offsetOf(pose.x, pose.y, pose.floor),
  );
  return {
    point,
    stackFloor: pose.floor,
    leavesFloor:
      previousFloor !== undefined && previousFloor !== pose.floor ? previousFloor : undefined,
  };
}
