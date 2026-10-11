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

import { Container, type Sprite } from "pixi.js";
import type { Defs } from "../defs/types";
import {
  type BodyDials,
  type BodyFrame,
  type BodyMotion,
  createBodyMotion,
  poseBody,
} from "../l3/body-pose";
import { framesByAnimation, loadL3Config, walkFramesPerCycle } from "../l3/config";
import type {
  AppearanceTextureCache,
  CompositeFrames,
} from "../render/appearance/appearance-texture";
import { newBodySprite, setBodyFrame } from "../render/body-sprite";
import { worldPointPx } from "../render/screen-position";
import type { RemoteMotion, RemotePose } from "../world/remote-motion";
import { buildPlayerAppearanceTuple, CROWD_FLOOR } from "./citizens";

export interface RemotePlayersWiring {
  readonly motion: RemoteMotion;
  /** The server clock in ms, or none before the first sample. */
  readonly serverNowMs: () => number | undefined;
  /** The caller's own character id, never drawn here. */
  readonly skip: () => string | undefined;
  /** City time in milliminutes, for the idle row; 0 when none. */
  readonly cityMilliminutes?: () => number | undefined;
  /** Every frame: where each drawn remote player is. */
  readonly onFrame?: (poses: Readonly<Record<string, RemotePose>>) => void;
}

export interface RemotePlayersLayer {
  update(): void;
  /** How many remote sprites are mounted right now. */
  count(): number;
}

interface Drawn {
  readonly sprite: Sprite;
  readonly motion: BodyMotion;
  readonly frame: BodyFrame;
  x: number;
  y: number;
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
  const l3 = loadL3Config(defs);
  const dials: BodyDials = {
    strideCells: l3.strideCells,
    walkFrames: walkFramesPerCycle(defs, "adult"),
    idleFrames: framesByAnimation(defs, "adult").idle ?? 1,
    idleFrameMilliminutes: l3.idleFrameMilliminutes,
  };
  const frames: CompositeFrames = await cache.acquire(buildPlayerAppearanceTuple(defs));
  const layer = new Container();
  layer.sortableChildren = true;
  parent.addChild(layer);
  const drawn = new Map<string, Drawn>();

  function update(): void {
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
        const frame: BodyFrame = { animation: "idle", direction: "down", frameIndex: 0 };
        const sprite = newBodySprite(frames, frame);
        layer.addChild(sprite);
        d = { sprite, motion: createBodyMotion(), frame, x: pose.x, y: pose.y };
        drawn.set(id, d);
      }
      poseBody(
        id,
        d.motion,
        pose.x - d.x,
        pose.y - d.y,
        wiring.cityMilliminutes?.() ?? 0,
        dials,
        d.frame,
      );
      d.x = pose.x;
      d.y = pose.y;
      const px = worldPointPx(pose.x, pose.y, pose.floor, tileSizePx, storeyHeightPx, zoom, 0);
      d.sprite.x = px.x;
      d.sprite.y = px.y;
      d.sprite.zIndex = pose.y;
      d.sprite.visible = pose.floor === CROWD_FLOOR;
      setBodyFrame(d.sprite, frames, d.frame);
    }
    if (poses) wiring.onFrame?.(poses);
  }

  return { update, count: () => drawn.size };
}
