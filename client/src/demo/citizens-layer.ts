// Story 1.10 (AC5, FR61/FR62): the one adapter that turns `citizens.ts`'s
// fixed fixtures into real, mounted sprites through the real appearance
// pipeline -- proof this pipeline draws a real street crowd, not only
// unit-tested pure logic. A second, additive layer under `world`, never
// part of `scene.ts`'s own depth-sorted `characters` pool (see
// `citizens.ts`'s own module doc for why). Takes its `AppearanceTextureCache`
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
import {
  buildCitizenFixtures,
  buildUniformedWalkerFixture,
  buildWalkerFixture,
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
  /** Every walker's current world position and facing direction, keyed by
   * citizen id -- `appearance-screenshots.spec.ts`'s only reader, so a
   * close-crop screenshot can wait for and centre on a specific walker in
   * a specific direction instead of guessing at timing. */
  walkerPositions(): Readonly<Record<string, { x: number; y: number; direction: string }>>;
}

interface WalkerState {
  readonly sprite: Sprite;
  readonly frames: CompositeFrames;
  readonly family: Family;
  readonly startX: number;
  readonly startY: number;
  elapsedMS: number;
  direction: string;
}

function advanceWalker(walker: WalkerState, deltaMS: number, tileSizePx: number): void {
  walker.elapsedMS += deltaMS;
  const pose = walkerPoseAt(walker.startX, walker.startY, walker.elapsedMS);
  walker.sprite.x = Math.round(pose.x * tileSizePx);
  walker.sprite.y = Math.round(pose.y * tileSizePx);
  walker.sprite.zIndex = pose.y;
  walker.sprite.texture = walker.frames.frame("walk", pose.direction, pose.frameIndex);
  walker.direction = pose.direction;
}

export async function mountCitizensLayer(
  world: Container,
  defs: Defs,
  tileSizePx: number,
  cache: AppearanceTextureCache,
  sidewalkTexture: Texture,
): Promise<CitizensLayerHandle> {
  // The crowd's own pavement, painted before the citizens so it sits
  // underneath them -- real `ModernTileset` sidewalk tiles, the same
  // asset the rest of the world uses: a citizen stands on pavement,
  // never on bare ground or the void.
  const bounds = plazaBounds();
  const ground = new Container();
  for (let y = Math.floor(bounds.y0); y < Math.ceil(bounds.y1); y++) {
    for (let x = Math.floor(bounds.x0); x < Math.ceil(bounds.x1); x++) {
      const tile = new Sprite(sidewalkTexture);
      tile.x = Math.round(x * tileSizePx);
      tile.y = Math.round(y * tileSizePx);
      ground.addChild(tile);
    }
  }
  world.addChild(ground);

  const layer = new Container();
  layer.sortableChildren = true;
  world.addChild(layer);

  const fixtures = [
    ...buildCitizenFixtures(defs),
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
      sprite.x = Math.round(fixture.gridX * tileSizePx);
      sprite.y = Math.round(fixture.gridY * tileSizePx);
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
          direction: fixture.facing,
        });
      }
    }),
  );

  function update(deltaMS: number): void {
    for (const walker of walkers.values()) advanceWalker(walker, deltaMS, tileSizePx);
  }

  function walkerPositions(): Readonly<
    Record<string, { x: number; y: number; direction: string }>
  > {
    const positions: Record<string, { x: number; y: number; direction: string }> = {};
    for (const [id, walker] of walkers) {
      positions[id] = { x: walker.sprite.x, y: walker.sprite.y, direction: walker.direction };
    }
    return positions;
  }

  function compareForE2e(
    tuple: AppearanceTuple,
    override: UniformOverride | null,
    animation: string,
    direction: string,
    frame: number,
  ): Promise<{ pipeline: PixelSnapshot; stack: PixelSnapshot }> {
    return cache
      .acquire(tuple, override)
      .then((frames) =>
        comparePipelineVsStack(defs, frames.texture, tuple, override, animation, direction, frame),
      );
  }

  return {
    textureIdsById,
    distinctTextureCount: nextTextureId,
    compareForE2e,
    update,
    walkerPositions,
  };
}
