// Story 4.4 (FR138): the other players of the test street, drawn at the
// position `world/remote-motion.ts` reports for the server clock minus the
// interpolation delay. They wear the default player look; facing and
// walk/idle are read from the motion, never from a stored column. Takes
// the shared `AppearanceTextureCache` and the floor-0 crowd container from
// `scene.ts`, and is advanced from the scene's own ticker (one driver of
// frame-by-frame state). Only floor 0 is drawn here: the test street's
// crowd container is a floor-0 visibility member.
// Excluded from `client/vitest.config.ts`'s coverage gate alongside the
// other real-Pixi adapters.

import { Container, Sprite } from "pixi.js";
import type { Defs } from "../defs/types";
import { loopFrameAt } from "../render/animation-frame";
import type {
  AppearanceTextureCache,
  CompositeFrames,
} from "../render/appearance/appearance-texture";
import { worldPointPx } from "../render/screen-position";
import { facingOf, type RemoteMotion, type RemotePose } from "../world/remote-motion";
import {
  buildPlayerAppearanceTuple,
  CROWD_FLOOR,
  WALK_FRAMES_PER_DIRECTION,
  WALK_FRAMES_PER_SECOND,
} from "./citizens";

export interface RemotePlayersWiring {
  readonly motion: RemoteMotion;
  /** The server clock in ms, or none before the first sample. */
  readonly serverNowMs: () => number | undefined;
  /** The caller's own character id, never drawn here. */
  readonly skip: () => string | undefined;
  /** Every frame: where each drawn remote player is. */
  readonly onFrame?: (poses: Readonly<Record<string, RemotePose>>) => void;
}

export interface RemotePlayersLayer {
  update(deltaMS: number): void;
  /** How many remote sprites are mounted right now. */
  count(): number;
}

interface Drawn {
  readonly sprite: Sprite;
  x: number;
  y: number;
  facing: string;
  walkedMs: number;
}

export async function mountRemotePlayersLayer(
  parent: Container,
  defs: Defs,
  cache: AppearanceTextureCache,
  tileSizePx: number,
  storeyHeightPx: number,
  zoom: number,
  wiring: RemotePlayersWiring,
): Promise<RemotePlayersLayer> {
  const frames: CompositeFrames = await cache.acquire(buildPlayerAppearanceTuple(defs));
  const layer = new Container();
  layer.sortableChildren = true;
  parent.addChild(layer);
  const drawn = new Map<string, Drawn>();

  function update(deltaMS: number): void {
    const now = wiring.serverNowMs();
    if (now === undefined) return;
    const skip = wiring.skip();
    for (const [id, d] of drawn) {
      if (!wiring.motion.has(id) || id === skip) {
        layer.removeChild(d.sprite);
        d.sprite.destroy();
        drawn.delete(id);
      }
    }
    // Built only for a caller that asked for it (a DEV build's e2e hook).
    const poses: Record<string, RemotePose> | undefined = wiring.onFrame ? {} : undefined;
    for (const id of wiring.motion.keys()) {
      if (id === skip) continue;
      const pose = wiring.motion.poseAt(id, now);
      if (!pose) continue;
      if (poses) poses[id] = pose;
      let d = drawn.get(id);
      if (!d) {
        const sprite = new Sprite(frames.frame("idle", "down", 0));
        sprite.anchor.set(0.5, 1);
        layer.addChild(sprite);
        d = { sprite, x: pose.x, y: pose.y, facing: "down", walkedMs: 0 };
        drawn.set(id, d);
      }
      const { facing, moving } = facingOf(pose.x - d.x, pose.y - d.y, d.facing);
      d.facing = facing;
      d.x = pose.x;
      d.y = pose.y;
      if (moving) d.walkedMs += deltaMS;
      else d.walkedMs = 0;
      const px = worldPointPx(pose.x, pose.y, pose.floor, tileSizePx, storeyHeightPx, zoom, 0);
      d.sprite.x = px.x;
      d.sprite.y = px.y;
      d.sprite.zIndex = pose.y;
      d.sprite.visible = pose.floor === CROWD_FLOOR;
      d.sprite.texture = moving
        ? frames.frame(
            "walk",
            facing,
            loopFrameAt(d.walkedMs, WALK_FRAMES_PER_SECOND, WALK_FRAMES_PER_DIRECTION),
          )
        : frames.frame("idle", facing, 0);
    }
    if (poses) wiring.onFrame?.(poses);
  }

  return { update, count: () => drawn.size };
}
