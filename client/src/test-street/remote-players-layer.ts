// Story 4.4 (FR138): the other players of the test street, drawn at the
// position `world/remote-motion.ts` reports for the server clock minus the
// interpolation delay. They wear the default player look; facing and
// walk/idle are read from the motion, never from a stored column. This is
// the motion -> pose -> `poseBody` driver only: the scene's `placeActor`
// (reached through the `ActorHost` it is given) owns the sprite's pool,
// position, sorting and visibility -- a remote player is a pool member of
// its floor, placed like the local player -- and the layer is
// advanced from the scene's own ticker (one driver of frame-by-frame state).
// Excluded from `client/vitest.config.ts`'s coverage gate alongside the
// other real-Pixi adapters.

import type { Sprite } from "pixi.js";
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
import type { RemoteMotion, RemotePose } from "../world/remote-motion";
import { buildPlayerAppearanceTuple } from "./citizens";

export interface RemotePlayersWiring {
  readonly motion: RemoteMotion;
  /** The server clock in ms, or none before the first sample. */
  readonly serverNowMs: () => number | undefined;
  /** The caller's own character id, never drawn here. */
  readonly skip: () => string | undefined;
  /** City time in milliminutes, for the idle row; 0 when none. */
  readonly cityMilliminutes?: () => number | undefined;
  /** The drawn-surface distance, in cells, of a ground move from a position
   * (story 15.21): the walk frame is fed it, so legs keep walking cadence on
   * a flight. Required: a wiring that forgets it would slide feet on stairs. */
  readonly drawnDistance: (x: number, y: number, floor: number, dx: number, dy: number) => number;
  /** Every frame: where each drawn remote player is and how it is drawn. */
  readonly onFrame?: (reports: Readonly<Record<string, RemoteDrawnReport>>) => void;
}

/** What a frame drew of one remote player (the DEV e2e hook's report). */
export interface RemoteDrawnReport extends RemotePose {
  readonly screenX: number;
  readonly screenY: number;
  readonly visible: boolean;
  /** The floor whose pool holds its sprite. */
  readonly stackFloor: number | undefined;
}

/** One remote player's seat in the scene: the scene places the sprite. */
export interface ActorHandle {
  place(x: number, y: number, floor: number): void;
  remove(): void;
  /** The floor whose pool is the sprite's parent right now. */
  stackFloor(): number | undefined;
}

/** What the scene gives the layer to put an actor on screen. */
export interface ActorHost {
  add(sprite: Sprite, x: number, y: number, floor: number): ActorHandle;
}

/** What a caller supplies; the scene adds the flights' `drawnDistance`. */
export type RemotePlayersSource = Omit<RemotePlayersWiring, "drawnDistance">;

export interface RemotePlayersLayer {
  update(): void;
  /** How many remote sprites are mounted right now. */
  count(): number;
}

interface Drawn {
  readonly sprite: Sprite;
  readonly handle: ActorHandle;
  readonly motion: BodyMotion;
  readonly frame: BodyFrame;
  x: number;
  y: number;
}

export async function mountRemotePlayersLayer(
  host: ActorHost,
  defs: Defs,
  cache: AppearanceTextureCache,
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
  const drawn = new Map<string, Drawn>();

  function update(): void {
    const now = wiring.serverNowMs();
    if (now === undefined) return;
    const skip = wiring.skip();
    for (const [id, d] of drawn) {
      if (!wiring.motion.has(id) || id === skip) {
        d.handle.remove();
        d.sprite.destroy();
        drawn.delete(id);
      }
    }
    // Built only for a caller that asked for it (a DEV build's e2e hook).
    const reports: Record<string, RemoteDrawnReport> | undefined = wiring.onFrame ? {} : undefined;
    for (const id of wiring.motion.keys()) {
      if (id === skip) continue;
      const pose = wiring.motion.poseAt(id, now);
      if (!pose) continue;
      let d = drawn.get(id);
      if (!d) {
        const frame: BodyFrame = { animation: "idle", direction: "down", frameIndex: 0 };
        const sprite = newBodySprite(frames, frame);
        const handle = host.add(sprite, pose.x, pose.y, pose.floor);
        d = { sprite, handle, motion: createBodyMotion(), frame, x: pose.x, y: pose.y };
        drawn.set(id, d);
      }
      const stepX = pose.x - d.x;
      const stepY = pose.y - d.y;
      poseBody(
        id,
        d.motion,
        stepX,
        stepY,
        wiring.drawnDistance(d.x, d.y, pose.floor, stepX, stepY),
        wiring.cityMilliminutes?.() ?? 0,
        dials,
        d.frame,
      );
      d.x = pose.x;
      d.y = pose.y;
      d.handle.place(pose.x, pose.y, pose.floor);
      setBodyFrame(d.sprite, frames, d.frame);
      if (reports) {
        reports[id] = {
          x: pose.x,
          y: pose.y,
          floor: pose.floor,
          screenX: d.sprite.x,
          screenY: d.sprite.y,
          visible: d.sprite.visible,
          stackFloor: d.handle.stackFloor(),
        };
      }
    }
    if (reports) wiring.onFrame?.(reports);
  }

  return { update, count: () => drawn.size };
}
