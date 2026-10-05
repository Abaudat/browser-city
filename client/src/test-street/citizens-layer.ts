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
import type { Defs } from "../defs/types";
import { CitizenBody, type CitizenFrame, createCitizenFrame } from "../l3/citizen";
import { type L3Config, pathConfigOf, walkFramesPerCycle } from "../l3/config";
import type { Walkability } from "../l3/micro-path";
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
  WALKER_SPECS,
} from "./citizens";
import { comparePipelineVsStack } from "./compare-pipeline-vs-stack";
import { Timetable } from "./timetable";

/** What the walking citizens need from L3: tile walkability and the dials. */
export interface WalkerSource {
  readonly walk: Walkability;
  readonly config: L3Config;
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
  /** Poses every walking citizen at city time `cityMilliminutes` -- called
   * from `scene.ts`'s own ticker, never a second ticker registered here
   * (one driver of frame-by-frame state). */
  update(cityMilliminutes: number): void;
  /** What each walking citizen's body says about itself (the L3 overlay). */
  l3Bodies(): readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly floor: number;
    readonly fallbacks: number;
    readonly paceOutOfBand: boolean;
  }[];
}

interface WalkerState {
  readonly sprite: Sprite;
  readonly frames: CompositeFrames;
  readonly timetable: Timetable;
  readonly body: CitizenBody;
  readonly frame: CitizenFrame;
}

function poseWalker(
  state: WalkerState,
  cityMilliminutes: number,
  tileSizePx: number,
  storeyHeightPx: number,
  zoom: number,
): void {
  const { frame, sprite, frames } = state;
  state.body.frameAt(state.timetable.stateAt(cityMilliminutes), cityMilliminutes, frame);
  const px = worldPointPx(frame.x, frame.y, CROWD_FLOOR, tileSizePx, storeyHeightPx, zoom, 0);
  sprite.x = px.x;
  sprite.y = px.y;
  sprite.zIndex = frame.y;
  sprite.texture = frames.frame(frame.animation, frame.direction, frame.frameIndex);
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
  l3: WalkerSource,
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

      const spec = WALKER_SPECS[fixture.id];
      if (spec) {
        const path = pathConfigOf(l3.config);
        walkers.set(fixture.id, {
          sprite,
          frames,
          timetable: new Timetable(spec, l3.config, l3.walk, path),
          body: new CitizenBody(
            l3.walk,
            path,
            {
              strideCells: l3.config.strideCells,
              framesPerCycle: walkFramesPerCycle(defs, body.family),
            },
            fixture.id,
          ),
          frame: createCitizenFrame(),
        });
      }
    }),
  );

  function update(cityMilliminutes: number): void {
    for (const walker of walkers.values()) {
      poseWalker(walker, cityMilliminutes, tileSizePx, storeyHeightPx, zoom);
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
    l3Bodies: () => {
      const out = [];
      const msPerMilliminute = l3.config.realMsPerCityMinute / 1000;
      for (const [id, walker] of walkers) {
        const report = walker.body.diagnostics(msPerMilliminute, l3.config);
        if (!report) continue;
        out.push({
          id,
          x: walker.frame.x,
          y: walker.frame.y,
          floor: walker.frame.floor,
          ...report,
        });
      }
      return out;
    },
  };
}
