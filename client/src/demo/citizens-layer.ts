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
  buildWalkerFixture,
  type DemoCitizensFixture,
  plazaBounds,
  WALKER_ID,
  WALKER_LOOP,
} from "./citizens";
import { comparePipelineVsStack } from "./compare-pipeline-vs-stack";

/** Cells per second the one animated citizen walks its loop at -- a
 * plain, fixed demo constant, not a `defs/` balance key (this citizen
 * is decorative, not simulated). */
const WALK_CELLS_PER_SECOND = 1.5;
const WALK_FRAMES_PER_DIRECTION = 6;
const WALK_FRAMES_PER_SECOND = 8;

function directionOf(dx: number, dy: number): string {
  if (dx > 0) return "right";
  if (dx < 0) return "left";
  if (dy < 0) return "up";
  return "down";
}

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
  /** Advances the walking citizen -- called from `scene.ts`'s own ticker,
   * never a second ticker registered here (one driver of frame-by-frame
   * state). */
  update(deltaMS: number): void;
}

export async function mountCitizensLayer(
  world: Container,
  defs: Defs,
  demoCitizens: DemoCitizensFixture,
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

  const fixtures = [...buildCitizenFixtures(demoCitizens), buildWalkerFixture(demoCitizens)];
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
  let walkerSprite: Sprite | undefined;
  let walkerFrames: CompositeFrames | undefined;
  let walkerFamily: Family | undefined;

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

      const sprite = new Sprite(frames.frame("idle", "down", 0));
      sprite.anchor.set(0.5, 1);
      sprite.x = Math.round(fixture.gridX * tileSizePx);
      sprite.y = Math.round(fixture.gridY * tileSizePx);
      sprite.zIndex = fixture.gridY;
      layer.addChild(sprite);

      if (fixture.id === WALKER_ID) {
        walkerSprite = sprite;
        walkerFrames = frames;
        walkerFamily = body.family;
      }
    }),
  );

  let legIndex = 0;
  let legProgress = 0; // 0..1 across the current leg
  let elapsedMS = 0;
  const walkerFixture = fixtures.find((f) => f.id === WALKER_ID);
  const startX = walkerFixture?.gridX ?? 0;
  const startY = walkerFixture?.gridY ?? 0;

  function legOrigin(index: number): { x: number; y: number } {
    let x = startX;
    let y = startY;
    for (let i = 0; i < index % WALKER_LOOP.length; i++) {
      const leg = WALKER_LOOP[i];
      if (leg) {
        x += leg.dx;
        y += leg.dy;
      }
    }
    return { x, y };
  }

  function update(deltaMS: number): void {
    if (!walkerSprite || !walkerFrames || !walkerFamily) return;
    const layout = layoutByFamily.get(walkerFamily);
    if (!layout) return;

    elapsedMS += deltaMS;
    const currentLeg = WALKER_LOOP[legIndex % WALKER_LOOP.length];
    if (!currentLeg) return;
    const legLengthCells = Math.hypot(currentLeg.dx, currentLeg.dy);
    const legDurationMS = (legLengthCells / WALK_CELLS_PER_SECOND) * 1000;
    legProgress += deltaMS / legDurationMS;
    while (legProgress >= 1) {
      legProgress -= 1;
      legIndex += 1;
    }

    const origin = legOrigin(legIndex);
    const leg = WALKER_LOOP[legIndex % WALKER_LOOP.length];
    if (!leg) return;
    const x = origin.x + leg.dx * legProgress;
    const y = origin.y + leg.dy * legProgress;
    walkerSprite.x = Math.round(x * tileSizePx);
    walkerSprite.y = Math.round(y * tileSizePx);
    walkerSprite.zIndex = y;

    const direction = directionOf(leg.dx, leg.dy);
    const frameIndex =
      Math.floor((elapsedMS / 1000) * WALK_FRAMES_PER_SECOND) % WALK_FRAMES_PER_DIRECTION;
    walkerSprite.texture = walkerFrames.frame("walk", direction, frameIndex);
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
  };
}
