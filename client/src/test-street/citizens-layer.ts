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
import { AvoidanceField, type AvoidDials } from "../l3/avoidance";
import { CitizenBody, type CitizenFrame, createCitizenFrame, type LifeDials } from "../l3/citizen";
import { idleFramesPerCycle, type L3Config, pathConfigOf, walkFramesPerCycle } from "../l3/config";
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
import { CHUNK_SIZE } from "../world/chunk";
import { cellOf } from "../world/ownership";
import {
  AVOIDANCE_SPECS,
  buildAvoidanceFixtures,
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
  /** A frozen crowd (a screenshot test) is staged with no avoidance
   * fixtures and never animated. */
  readonly frozen?: boolean;
}

/** One L3 body as the debug tooling reads it. */
export interface L3BodyReport {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  /** Segments walked straight for want of a path. */
  readonly fallbacks: number;
  /** Some segment is walked outside the walking-pace band. */
  readonly paceOutOfBand: boolean;
  /** The sidestep in cells (positive to the right of the heading), whether
   * the body's neighbours were cut at the cap, and whether its sidestep met a
   * blocked tile. */
  readonly avoidance?: {
    readonly offsetCells: number;
    readonly capped: boolean;
    readonly blocked: boolean;
  };
  /** The flavour a standing body is showing, when not nothing. */
  readonly activity?: string;
}

/** What two clients must agree on, for one citizen at one city time (the
 * documented list in `docs/architecture.md`): the ledger position, what it is
 * doing, the frame, the facing and the sidestep. */
export interface L3AgreementSample {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly activity: "walk" | "idle" | "glance";
  readonly frameIndex: number;
  readonly facing: string;
  readonly offsetX: number;
  readonly offsetY: number;
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
  l3Bodies(): readonly L3BodyReport[];
  /** Every citizen's agreed state at city time `cityMilliminutes`, computed
   * from scratch -- what the e2e agreement spec compares between clients. */
  agreementAt(cityMilliminutes: number): readonly L3AgreementSample[];
}

/** One citizen the layer animates: a walker on a timetable, or a standing
 * member of the crowd. Both play flavour; both are bodies avoidance knows. */
interface Member {
  readonly id: string;
  readonly sprite: Sprite;
  readonly frames: CompositeFrames;
  readonly body: CitizenBody;
  readonly frame: CitizenFrame;
  /** Present for a walker; a stander has `at`. */
  readonly timetable?: Timetable;
  readonly at?: { readonly x: number; readonly y: number };
  readonly facing: string;
  index: number;
  glancing: boolean;
}

/** The shared half of one frame: every member's ledger pose, then every
 * sidestep. Used for drawing and for the agreement sample alike, so the two
 * cannot differ. */
function solve(
  members: Iterable<Member>,
  t: number,
  field: AvoidanceField,
  dials: AvoidDials,
  walk: Walkability,
): void {
  field.reset();
  for (const m of members) {
    const f = m.frame;
    if (m.timetable) {
      m.body.frameAt(m.timetable.stateAt(t), t, f);
    } else {
      const at = m.at as { x: number; y: number };
      m.body.frameAt(
        {
          kind: "at",
          node: { x: cellOf(at.x), y: cellOf(at.y), floor: CROWD_FLOOR },
          facing: m.facing as never,
        },
        t,
        f,
      );
      // A stander is drawn where it stands, not on its tile's centre.
      f.x = at.x;
      f.y = at.y;
    }
    m.index = field.add(m.id, f.x, f.y, f.floor, f.headingX, f.headingY, f.moving, f.ramp);
  }
  field.resolve(dials, walk);
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
    ...(l3.frozen ? [] : buildAvoidanceFixtures(defs)),
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
  const members = new Map<string, Member>();
  const path = pathConfigOf(l3.config);
  const avoid: AvoidDials = {
    radiusCells: l3.config.avoidRadiusCells,
    maxOffsetCells: l3.config.avoidMaxOffsetCells,
    maxNeighbours: l3.config.avoidMaxNeighbours,
    halfWidthCells: l3.config.bodyHalfWidthCells,
    chunkSize: CHUNK_SIZE,
  };
  const field = new AvoidanceField();
  /** How to build one member's body and timetable again, for the scratch set. */
  const makers = new Map<string, () => Pick<Member, "body" | "timetable">>();

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

      const spec = WALKER_SPECS[fixture.id] ?? AVOIDANCE_SPECS[fixture.id];
      const life: LifeDials = {
        bucketMilliminutes: l3.config.flavourBucketMilliminutes,
        glancePercent: l3.config.flavourGlancePercent,
        glanceMilliminutes: l3.config.flavourGlanceMilliminutes,
        idleFrameMilliminutes: l3.config.idleFrameMilliminutes,
        idleFrames: idleFramesPerCycle(defs, body.family),
        rampCells: l3.config.avoidRadiusCells,
      };
      const make = (): Pick<Member, "body" | "timetable"> => ({
        timetable: spec ? new Timetable(spec, l3.config, l3.walk, path) : undefined,
        body: new CitizenBody(
          l3.walk,
          path,
          {
            strideCells: l3.config.strideCells,
            framesPerCycle: walkFramesPerCycle(defs, body.family),
          },
          fixture.id,
          life,
        ),
      });
      makers.set(fixture.id, make);
      members.set(fixture.id, {
        id: fixture.id,
        sprite,
        frames,
        ...make(),
        frame: createCitizenFrame(),
        at: spec ? undefined : { x: fixture.gridX, y: fixture.gridY },
        facing: fixture.facing,
        index: -1,
        glancing: false,
      });
    }),
  );

  function update(cityMilliminutes: number): void {
    solve(members.values(), cityMilliminutes, field, avoid, l3.walk);
    for (const m of members.values()) {
      const { frame, sprite, frames } = m;
      m.glancing = frame.glancing;
      sprite.texture = frames.frame(frame.animation, frame.direction, frame.frameIndex);
      if (!m.timetable) continue;
      const ox = field.offsetX(m.index);
      const oy = field.offsetY(m.index);
      const px = worldPointPx(
        frame.x + ox,
        frame.y + oy,
        CROWD_FLOOR,
        tileSizePx,
        storeyHeightPx,
        zoom,
        0,
      );
      sprite.x = px.x;
      sprite.y = px.y;
      sprite.zIndex = frame.y + oy;
    }
  }

  let scratch: Member[] | undefined;
  const scratchField = new AvoidanceField();
  function agreementAt(cityMilliminutes: number): readonly L3AgreementSample[] {
    scratch ??= [...members.values()].map((m) => ({
      ...m,
      ...(makers.get(m.id) as () => Pick<Member, "body" | "timetable">)(),
      frame: createCitizenFrame(),
    }));
    solve(scratch, cityMilliminutes, scratchField, avoid, l3.walk);
    // Sorted by id: members mount as their textures arrive, in any order.
    return [...scratch]
      .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
      .map((m) => {
        const activity =
          m.frame.animation === "walk" ? "walk" : m.frame.glancing ? "glance" : "idle";
        return {
          id: m.id,
          x: m.frame.x,
          y: m.frame.y,
          activity,
          frameIndex: m.frame.frameIndex,
          facing: m.frame.direction,
          offsetX: scratchField.offsetX(m.index),
          offsetY: scratchField.offsetY(m.index),
        };
      });
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
    agreementAt,
    l3Bodies: () => {
      const out: L3BodyReport[] = [];
      const msPerMilliminute = l3.config.realMsPerCityMinute / 1000;
      for (const m of members.values()) {
        const frame = m.frame;
        const report = m.body.diagnostics(msPerMilliminute, l3.config);
        const glancing = m.glancing;
        if (!report && !glancing) continue;
        const ox = field.offsetX(m.index);
        const oy = field.offsetY(m.index);
        out.push({
          id: m.id,
          x: frame.x + ox,
          y: frame.y + oy,
          floor: frame.floor,
          fallbacks: report?.fallbacks ?? 0,
          paceOutOfBand: report?.paceOutOfBand ?? false,
          avoidance: {
            // Positive to the right of the heading.
            offsetCells: ox * -frame.headingY + oy * frame.headingX,
            capped: field.capped(m.index),
            blocked: field.blocked(m.index),
          },
          activity: glancing ? "glance" : undefined,
        });
      }
      return out;
    },
  };
}
