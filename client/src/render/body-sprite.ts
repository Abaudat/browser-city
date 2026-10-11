// The one place a character's texture is chosen (NFR24): the local player,
// remote players and citizens all draw a body through these. The frame itself
// comes from `l3/`'s `poseBody` (movement-driven) or `CitizenBody` (ledger);
// this module only turns (animation, direction, frame) into a sprite texture.
// `scripts/ci/check-one-body-path.sh` holds `.frame(` to this file.

import { Sprite, type Texture } from "pixi.js";
import type { CompositeFrames } from "./appearance/appearance-texture";

/** The frame to draw: what `poseBody` and `CitizenFrame` both write. */
export interface BodyFrameLike {
  readonly animation: string;
  readonly direction: string;
  readonly frameIndex: number;
}

export function bodyTexture(frames: CompositeFrames, f: BodyFrameLike): Texture {
  return frames.frame(f.animation, f.direction, f.frameIndex);
}

/** A character sprite, feet-anchored, showing `f`. */
export function newBodySprite(frames: CompositeFrames, f: BodyFrameLike): Sprite {
  const sprite = new Sprite(bodyTexture(frames, f));
  sprite.anchor.set(0.5, 1);
  return sprite;
}

export function setBodyFrame(sprite: Sprite, frames: CompositeFrames, f: BodyFrameLike): void {
  sprite.texture = bodyTexture(frames, f);
}
