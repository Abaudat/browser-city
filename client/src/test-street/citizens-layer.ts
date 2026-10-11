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
import { type AtState, CitizenBody } from "../l3/citizen";
import { type L3Config, pathConfigOf, walkFramesPerCycle } from "../l3/config";
import type { Facing } from "../l3/gait";
import { type LedgerPoint, ledgerPositionAt } from "../l3/ledger-position";
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
import { bodyTexture, newBodySprite, setBodyFrame } from "../render/body-sprite";
import { snapToScreenPx, worldPointPx } from "../render/screen-position";
import { type BodyCandidate, bodyZoneOf, planBodies, type Rect } from "../world/body-zone";
import { cellOf } from "../world/ownership";
import {
  AVOIDANCE_SPECS,
  buildAvoidanceFixtures,
  buildCitizenFixtures,
  buildUniformedWalkerFixture,
  buildWalkerFixture,
  type CitizenFixture,
  CROWD_FLOOR,
  isStagingCell,
  plazaBounds,
  stagingBounds,
  WALKER_SPECS,
} from "./citizens";
import { comparePipelineVsStack } from "./compare-pipeline-vs-stack";
import {
  type LifeMember,
  type LifeSample,
  lifeDialsFor,
  type StreetLife,
  standState,
} from "./street-life";
import { Timetable, type TimetableSpec } from "./timetable";

/** What the walking citizens need from L3: tile walkability and the dials. */
export interface WalkerSource {
  readonly walk: Walkability;
  readonly config: L3Config;
  /** Every ledger-driven citizen on the street, the layer's own included. */
  readonly life: StreetLife;
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

export interface CitizensLayerHandle {
  /** One opaque id per distinct `CompositeFrames` instance actually
   * handed out, keyed by citizen id -- citizens sharing a tuple+override
   * share an id (AC5's "one composite per unique key", proven against
   * the real, mounted cache). */
  readonly textureIdsById: Readonly<Record<string, number>>;
  readonly distinctTextureCount: number;
  /** How many citizens have a body right now (drawn, not pending). */
  bodyCount(): number;
  compareForE2e(
    tuple: AppearanceTuple,
    override: UniformOverride | null,
    animation: string,
    direction: string,
    frame: number,
  ): Promise<{ pipeline: PixelSnapshot; stack: PixelSnapshot }>;
  /** Instantiates and discards bodies for the body zone around `viewport`
   * (cells) as judged on each citizen's ledger position at city time `t`,
   * then draws every body as the street's life was last solved -- called from
   * `scene.ts`'s own ticker, never a second ticker registered here (one
   * driver of frame-by-frame state). No viewport means everyone has a body. */
  update(t: number | undefined, viewport?: Rect): void;
  /** What each walking citizen's body says about itself (the L3 overlay). */
  l3Bodies(): readonly L3BodyReport[];
  /** Every citizen's agreed state at city time `cityMilliminutes`, computed
   * from scratch -- what the e2e agreement spec compares between clients. */
  agreementAt(cityMilliminutes: number): readonly LifeSample[];
}

/** A citizen the layer draws: its sprite and its place in the street's life. */
interface Drawn {
  readonly sprite: Sprite;
  readonly frames: CompositeFrames;
  readonly member: LifeMember;
  /** Standing citizens keep their drawn position; walkers move. */
  readonly walks: boolean;
}

/** A citizen of the street: its data, with or without a body. */
interface Citizen {
  readonly fixture: CitizenFixture;
  readonly override: UniformOverride | null;
  readonly family: Family;
  readonly spec: TimetableSpec | undefined;
  /** The ledger: a walker's legs. Absent for a standing citizen. */
  readonly ledger: Timetable | undefined;
  /** Bumped on every spawn; an acquire that resolves under an old token has
   * been despawned meanwhile and only releases. */
  token: number;
  readonly make: () => { body: CitizenBody; timetable?: Timetable };
  readonly stand: AtState | undefined;
  readonly standAt: { readonly x: number; readonly y: number } | undefined;
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
  /** The zone of the first frame. No viewport: everyone has a body. */
  options: { initialViewport?: Rect; initialCityMilliminutes?: number } = {},
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
  // The avoidance staging's own patch, south of the street (never mounted for
  // a frozen crowd, whose baselines it would move).
  if (!l3.frozen) {
    const stage = stagingBounds();
    for (let y = stage.y0; y < stage.y1; y++) {
      for (let x = stage.x0; x < stage.x1; x++) {
        if (!isStagingCell(x, y)) continue;
        const tile = new Sprite(sidewalkTexture);
        tile.x = snapToScreenPx(x * tileSizePx, zoom);
        tile.y = snapToScreenPx(y * tileSizePx, zoom);
        ground.addChild(tile);
      }
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
  const path = pathConfigOf(l3.config);
  const drawn = new Map<string, Drawn>();
  let rankDirty = true;

  const citizens = new Map<string, Citizen>();
  for (const fixture of fixtures) {
    const override = fixture.professionKey ? resolveUniform(defs, fixture.professionKey) : null;
    const body = defs.bodies.find((b) => b.id === fixture.tuple.body);
    if (!body) throw new Error(`citizens-layer: no body def with id ${fixture.tuple.body}`);
    if (!layoutByFamily.get(body.family)) {
      throw new Error(`citizens-layer: no appearance layout for family '${body.family}'`);
    }
    const spec = WALKER_SPECS[fixture.id] ?? AVOIDANCE_SPECS[fixture.id];
    const life = lifeDialsFor(defs, l3.config, body.family);
    const make = (): { body: CitizenBody; timetable?: Timetable } => ({
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
    const stand = spec
      ? undefined
      : standState(
          // A node coordinate, not feet: a citizen that walks a flight
          // must use `bodyCell` of its feet instead.
          { x: cellOf(fixture.gridX), y: cellOf(fixture.gridY) },
          CROWD_FLOOR,
          fixture.facing as Facing,
        );
    const standAt = spec ? undefined : { x: fixture.gridX, y: fixture.gridY };
    const ledger = spec ? new Timetable(spec, l3.config, l3.walk, path) : undefined;
    // Agreement samples every citizen, with a body or not.
    l3.life.declare({
      id: fixture.id,
      timetable: ledger,
      stand,
      standAt,
      remake: make,
    });
    citizens.set(fixture.id, {
      fixture,
      override,
      family: body.family,
      spec,
      ledger,
      token: 0,
      make,
      stand,
      standAt,
    });
  }

  /** Ids that hold a body or are waiting for its frames. */
  const live = new Set<string>();

  /** Gives `c` a body: its look first, the sprite only once the frames are
   * resolved -- a body never draws before it is ready. */
  async function spawn(c: Citizen): Promise<void> {
    const { fixture, override } = c;
    const token = ++c.token;
    live.add(fixture.id);
    const frames = await cache.acquire(fixture.tuple, override);
    if (c.token !== token || !live.has(fixture.id)) {
      // Despawned while the acquire was pending.
      cache.release(fixture.tuple, override);
      return;
    }
    textureIdsById[fixture.id] = idFor(frames);

    const sprite = newBodySprite(frames, {
      animation: "idle",
      direction: fixture.facing,
      frameIndex: 0,
    });
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

    const member = l3.life.add({
      id: fixture.id,
      ...c.make(),
      stand: c.stand,
      standAt: c.standAt,
      remake: c.make,
    });
    drawn.set(fixture.id, { sprite, frames, member, walks: c.spec !== undefined });
    rankDirty = true;
  }

  /** Discards a body whole and releases its slot; nothing merges back. */
  function despawn(id: string): void {
    live.delete(id);
    const d = drawn.get(id);
    if (!d) return; // pending: `spawn` releases when its acquire lands
    const c = citizens.get(id) as Citizen;
    layer.removeChild(d.sprite);
    d.sprite.destroy();
    l3.life.remove(d.member);
    drawn.delete(id);
    cache.release(c.fixture.tuple, c.override);
    rankDirty = true;
  }

  const here: LedgerPoint = { x: 0, y: 0, floor: 0 };
  /** A citizen's ledger position at `t`: cheap, never a body's pose. */
  function candidateOf(c: Citizen, t: number): BodyCandidate {
    if (c.ledger) {
      ledgerPositionAt(c.ledger.stateAt(t), t, here);
      return { id: c.fixture.id, x: here.x, y: here.y };
    }
    return { id: c.fixture.id, x: c.fixture.gridX, y: c.fixture.gridY };
  }

  /** Runs the body zone: despawns first, then spawns; returns the spawns. */
  function applyZone(t: number, viewport: Rect | undefined): Promise<void>[] {
    const candidates: BodyCandidate[] = [];
    for (const c of citizens.values()) candidates.push(candidateOf(c, t));
    const zone = viewport
      ? bodyZoneOf(viewport)
      : {
          spawn: { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity },
          despawn: { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity },
        };
    const plan = planBodies(live, candidates, zone);
    for (const id of plan.despawn) despawn(id);
    return plan.spawn.map((id) => spawn(citizens.get(id) as Citizen));
  }

  // The bodies of the first frame are awaited, so the scene's first draw
  // shows them; later ones arrive as they walk into the zone.
  await Promise.all(applyZone(options.initialCityMilliminutes ?? 0, options.initialViewport));

  /** Each citizen's place in id order, so two at one depth always draw in the
   * same order whatever order their textures arrived in. Rebuilt when the set
   * of citizens changes. */
  let idRanks = new Map<string, number>();
  function rankIds(): void {
    idRanks = new Map([...drawn.keys()].sort().map((id, rank) => [id, rank]));
  }
  /** Far below one screen pixel of depth. */
  const ID_DEPTH_STEP = 1e-6;

  /** Draws the street's life as `StreetLife.solve` last left it. */
  function update(t: number | undefined, viewport?: Rect): void {
    if (t !== undefined) applyZone(t, viewport);
    if (rankDirty) {
      rankIds();
      rankDirty = false;
    }
    for (const d of drawn.values()) {
      const { frame } = d.member;
      setBodyFrame(d.sprite, d.frames, frame);
      if (!d.walks) continue;
      const ox = l3.life.offsetX(d.member);
      const oy = l3.life.offsetY(d.member);
      const px = worldPointPx(
        frame.x + ox,
        frame.y + oy,
        CROWD_FLOOR,
        tileSizePx,
        storeyHeightPx,
        zoom,
        0,
      );
      d.sprite.x = px.x;
      d.sprite.y = px.y;
      // Depth follows the drawn position; equal depths go by id.
      d.sprite.zIndex = frame.y + oy + (idRanks.get(d.member.id) as number) * ID_DEPTH_STEP;
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
          bodyTexture(frames, { animation, direction, frameIndex: frame }),
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
    get distinctTextureCount() {
      return nextTextureId;
    },
    bodyCount: () => drawn.size,
    compareForE2e,
    update,
    agreementAt: (t) => l3.life.agreementAt(t),
    l3Bodies: () => {
      const out: L3BodyReport[] = [];
      const msPerMilliminute = l3.config.realMsPerCityMinute / 1000;
      for (const d of drawn.values()) {
        const m = d.member;
        const report = m.body.diagnostics(msPerMilliminute, l3.config);
        const flavour = m.frame.flavour;
        if (!report && !flavour) continue;
        const ox = l3.life.offsetX(m);
        const oy = l3.life.offsetY(m);
        out.push({
          id: m.id,
          x: m.frame.x + ox,
          y: m.frame.y + oy,
          floor: m.frame.floor,
          fallbacks: report?.fallbacks ?? 0,
          paceOutOfBand: report?.paceOutOfBand ?? false,
          avoidance: {
            // Positive to the right of the heading.
            offsetCells: ox * -m.frame.headingY + oy * m.frame.headingX,
            capped: l3.life.field.capped(m.index),
            blocked: l3.life.field.blocked(m.index),
          },
          activity: flavour || undefined,
        });
      }
      return out;
    },
  };
}
