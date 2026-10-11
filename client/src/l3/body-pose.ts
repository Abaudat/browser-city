// The one body pose function (NFR24): motion delta, gait state and the
// layout's frame counts in, (animation, facing, frame) out. The local player,
// remote players and any body driven by its own movement call it; nothing
// else decides a character's facing or walk frame from movement.

import { idleFrameAt } from "./flavour";
import { advanceGait, type Facing, type GaitState, phaseOffsetFor, walkFrame } from "./gait";

export interface BodyDials {
  readonly strideCells: number;
  readonly walkFrames: number;
  readonly idleFrames: number;
  readonly idleFrameMilliminutes: number;
}

/** What a movement-driven body carries between frames. */
export type BodyMotion = GaitState;

/** The frame to draw, written in place. */
export interface BodyFrame {
  animation: "walk" | "idle";
  direction: Facing;
  frameIndex: number;
}

export function createBodyMotion(facing: Facing = "down"): BodyMotion {
  return { facing, walked: 0 };
}

/** Poses body `id` after a move of `(dx, dy)` cells actually made this frame,
 * at city time `t`. A frame with no displacement is the idle row on the last
 * facing. */
export function poseBody(
  id: string,
  motion: BodyMotion,
  dx: number,
  dy: number,
  t: number,
  dials: BodyDials,
  out: BodyFrame,
): void {
  const moving = advanceGait(motion, dx, dy);
  out.direction = motion.facing;
  if (moving) {
    out.animation = "walk";
    out.frameIndex = walkFrame(
      motion.walked,
      dials.strideCells,
      phaseOffsetFor(id),
      dials.walkFrames,
    );
  } else {
    out.animation = "idle";
    out.frameIndex = idleFrameAt(id, t, dials.idleFrames, dials.idleFrameMilliminutes);
  }
}
