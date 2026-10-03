// Story 1.10 (AC5, FR61/FR62): the one adapter that turns `citizens.ts`'s
// fixed fixtures into real, mounted sprites through the real appearance
// pipeline -- proof this pipeline draws a real street crowd, not only
// unit-tested pure logic. Never part of `scene.ts`'s own depth-sorted
// `characters` pool (see `citizens.ts`'s own module doc for why); instead
// this module only ever populates the floor-0 container `scene.ts`
// already created, registered as a visibility member and attached under
// `render/floor-stacks.ts`'s own floor-0 stack before this function is
// even called (story 15.8) -- it never creates or parents a container of
// its own against `world`. Takes its `AppearanceTextureCache`
// from the caller rather than building its own, so the player's own
// sprite (`scene.ts`) and the crowd share one cache -- a player who
// happens to match a crowd member's tuple reuses that texture too.
// Excluded from `client/vitest.config.ts`'s coverage gate alongside the
// other real-Pixi adapters it composes.

import { Container, Sprite, type Texture } from "pixi.js";
import type { Defs, Family } from "../defs/types";
import type {
  AppearanceTextureCache,
  CompositeFrames,
} from "../render/appearance/appearance-texture";
import {
  type AppearanceTuple,
  resolveUniform,
  type UniformOverride,
} from "../render/appearance/composite";
import type { PixelSnapshot } from "../render/appearance/pixel-snapshot";
import { snapToScreenPx, worldPointPx } from "../render/screen-position";
import { cellOf } from "../world/ownership";
import {
  buildCitizenFixtures,
  buildUniformedWalkerFixture,
  buildWalkerFixture,
  CROWD_FLOOR,
  plazaBounds,
  UNIFORMED_WALKER_ID,
  WALKER_ID,
  walkerPoseAt,
} from "./citizens";
import { comparePipelineVsStack } from "./compare-pipeline-vs-stack";

const WALKER_IDS: readonly string[] = [WALKER_ID, UNIFORMED_WALKER_ID];

export interface CitizensLayerHandle {
  /** One opaque id per distinct `CompositeFrames` instance actually
   * handed out, keyed by citizen id -- citizens sharing a tuple+override
   * share an id (AC5's "one composite per unique key", proven against
   * the real, mounted cache). */
  readonly textureIdsById: Readonly<Record<string, number>>;
  readonly distinctTextureCount: number;
  compareForE2e(
    tuple: AppearanceTuple,
    override: UniformOverride | null,
    animation: string,
    direction: string,
    frame: number,
  ): Promise<{ pipeline: PixelSnapshot; stack: PixelSnapshot }>;
  /** Advances every walking citizen -- called from `scene.ts`'s own
   * ticker, never a second ticker registered here (one driver of
   * frame-by-frame state). */
  update(deltaMS: number): void;
}

interface WalkerState {
  readonly sprite: Sprite;
  readonly frames: CompositeFrames;
  readonly family: Family;
  readonly startX: number;
  readonly startY: number;
  elapsedMS: number;
}

function advanceWalker(
  walker: WalkerState,
  deltaMS: number,
  tileSizePx: number,
  storeyHeightPx: number,
  zoom: number,
): void {
  walker.elapsedMS += deltaMS;
  const pose = walkerPoseAt(walker.startX, walker.startY, walker.elapsedMS);
  const px = worldPointPx(pose.x, pose.y, CROWD_FLOOR, tileSizePx, storeyHeightPx, zoom, 0);
  walker.sprite.x = px.x;
  walker.sprite.y = px.y;
  walker.sprite.zIndex = pose.y;
  walker.sprite.texture = walker.frames.frame("walk", pose.direction, pose.frameIndex);
}

export async function mountCitizensLayer(
  parent: Container,
  defs: Defs,
  tileSizePx: number,
  storeyHeightPx: number,
  zoom: number,
  cache: AppearanceTextureCache,
  sidewalkTexture: Texture,
  atlasBaseUrl: string,
  identicalTuples = false,
): Promise<CitizensLayerHandle> {
  // The crowd's own pavement, painted before the citizens so it sits
  // underneath them -- real `ModernTileset` sidewalk tiles, the same
  // asset the rest of the world uses: a citizen stands on pavement,
  // never on bare ground or the void. `parent` is `scene.ts`'s own
  // floor-0 crowd container (story 15.8) -- already attached under the
  // floor-0 stack and registered as a visibility member before this
  // function is ever called, so these two containers need no visibility
  // opinion of their own; they simply draw inside whatever `parent`'s
  // own `visible` says.
  const bounds = plazaBounds();
  const ground = new Container();
  for (let y = cellOf(bounds.y0); y < Math.ceil(bounds.y1); y++) {
    for (let x = cellOf(bounds.x0); x < Math.ceil(bounds.x1); x++) {
      const tile = new Sprite(sidewalkTexture);
      tile.x = snapToScreenPx(x * tileSizePx, zoom);
      tile.y = snapToScreenPx(y * tileSizePx, zoom);
      ground.addChild(tile);
    }
  }
  parent.addChild(ground);

  const layer = new Container();
  layer.sortableChildren = true;
  parent.addChild(layer);

  const fixtures = [
    ...buildCitizenFixtures(defs, identicalTuples),
    buildWalkerFixture(defs),
    buildUniformedWalkerFixture(defs),
  ];
  const layoutByFamily = new Map(defs.appearanceLayouts.map((l) => [l.family, l]));

  const textureIds = new Map<CompositeFrames, number>();
  let nextTextureId = 0;
  function idFor(frames: CompositeFrames): number {
    let id = textureIds.get(frames);
    if (id === undefined) {
      id = nextTextureId++;
      textureIds.set(frames, id);
    }
    return id;
  }

  const textureIdsById: Record<string, number> = {};
  const walkers = new Map<string, WalkerState>();

  await Promise.all(
    fixtures.map(async (fixture) => {
      const override = fixture.professionKey ? resolveUniform(defs, fixture.professionKey) : null;
      const body = defs.bodies.find((b) => b.id === fixture.tuple.body);
      if (!body) throw new Error(`citizens-layer: no body def with id ${fixture.tuple.body}`);
      const layout = layoutByFamily.get(body.family);
      if (!layout) {
        throw new Error(`citizens-layer: no appearance layout for family '${body.family}'`);
      }

      const frames = await cache.acquire(fixture.tuple, override);
      textureIdsById[fixture.id] = idFor(frames);

      const sprite = new Sprite(frames.frame("idle", fixture.facing, 0));
      sprite.anchor.set(0.5, 1);
      // A standing citizen never moves, so it keeps its whole-world-pixel
      // placement (zoom 1, itself a whole screen pixel): its scatter
      // position is fractional, and a finer snap would only shift it.
      const px = worldPointPx(
        fixture.gridX,
        fixture.gridY,
        CROWD_FLOOR,
        tileSizePx,
        storeyHeightPx,
        1,
        0,
      );
      sprite.x = px.x;
      sprite.y = px.y;
      sprite.zIndex = fixture.gridY;
      layer.addChild(sprite);

      if (WALKER_IDS.includes(fixture.id)) {
        walkers.set(fixture.id, {
          sprite,
          frames,
          family: body.family,
          startX: fixture.gridX,
          startY: fixture.gridY,
          elapsedMS: 0,
        });
      }
    }),
  );

  function update(deltaMS: number): void {
    for (const walker of walkers.values()) {
      advanceWalker(walker, deltaMS, tileSizePx, storeyHeightPx, zoom);
    }
  }

  function compareForE2e(
    tuple: AppearanceTuple,
    override: UniformOverride | null,
    animation: string,
    direction: string,
    frame: number,
  ): Promise<{ pipeline: PixelSnapshot; stack: PixelSnapshot }> {
    // Never a bare `cache.acquire` with no matching `release` -- this is
    // called dozens of times over, once per grid cell, for a handful of
    // fixed tuples (`appearance.spec.ts`'s own full comparison grid), and
    // with no release each call would permanently hold its own slot,
    // leaking one reference per call forever (Quentin's direction, cycle
    // 1). `comparePipelineVsStack` reads every pixel it needs out of the
    // texture synchronously, before its own promise resolves, so the
    // texture reference is already dropped by the time `release` below
    // runs -- never the other way (a release before the read completed
    // could hand this exact slot to a new occupant mid-read).
    return cache
      .acquire(tuple, override)
      .then((frames) =>
        comparePipelineVsStack(
          defs,
          atlasBaseUrl,
          frames.frame(animation, direction, frame),
          tuple,
          override,
          animation,
          direction,
          frame,
        ).finally(() => cache.release(tuple, override)),
      );
  }

  return {
    textureIdsById,
    distinctTextureCount: nextTextureId,
    compareForE2e,
    update,
  };
}
