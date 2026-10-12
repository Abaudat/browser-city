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
import type { AtState } from "../l3/citizen";
import { type L3Config, pathConfigOf, walkFramesPerCycle } from "../l3/config";
import type { Facing } from "../l3/gait";
import { type LedgerPoint, ledgerPositionAt } from "../l3/ledger-position";
import type { Walkability } from "../l3/micro-path";
import type { ClientMember, L3Client } from "../l3-worker/client";
import type { CitizenInit } from "../l3-worker/protocol";
import type {
  AppearanceTextureCache,
  CompositeFrames,
} from "../render/appearance/appearance-texture";
import {
  type AppearanceTuple,
  appearanceCacheKey,
  resolveUniform,
  type UniformOverride,
} from "../render/appearance/composite";
import type { PixelSnapshot } from "../render/appearance/pixel-snapshot";
import { bodyTexture, newBodySprite, setBodyFrame } from "../render/body-sprite";
import { snapToScreenPx, worldPointPx, worldPointPxInto } from "../render/screen-position";
import { BodyLifecycle } from "../world/body-lifecycle";
import { type BodyCandidate, type BodyZone, WHOLE_ZONE } from "../world/body-zone";
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
import type { RushCrowd } from "./rush-crowd";
import { type LifeSample, lifeDialsFor, standState } from "./street-life";
import { Timetable, type TimetableSpec } from "./timetable";

/** What the walking citizens need from L3: tile walkability and the dials. */
export interface WalkerSource {
  readonly walk: Walkability;
  readonly config: L3Config;
  /** The worker that solves every ledger-driven citizen on the street, the
   * layer's own included. */
  readonly client: L3Client;
  /** A frozen crowd (a screenshot test) is staged with no avoidance
   * fixtures and never animated. */
  readonly frozen?: boolean;
  /** Story 5.4: the dev-only rush-hour load, added to the street's citizens. */
  readonly rush?: RushCrowd;
}

/** A body's sprite bounds on the renderer, in pixels. */
export interface BodyScreenBounds {
  readonly id: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One L3 body as the debug tooling reads it. */
export interface L3BodyReport {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  /** The body is walking: on a leg and advancing, not standing or gesturing. */
  readonly moving: boolean;
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
  /** How many citizens the street has, with a body or not. */
  readonly citizenCount: number;
  /** Where each body is on screen, in renderer pixels (a DEV build's e2e). */
  bodyBounds(): readonly BodyScreenBounds[];
  compareForE2e(
    tuple: AppearanceTuple,
    override: UniformOverride | null,
    animation: string,
    direction: string,
    frame: number,
  ): Promise<{ pipeline: PixelSnapshot; stack: PixelSnapshot }>;
  /** Instantiates and discards bodies for `zone` as judged on each citizen's
   * ledger position at city time `t`, then draws every body as the street's
   * life was last solved -- called from `scene.ts`'s own ticker, never a
   * second ticker registered here (one driver of frame-by-frame state). No
   * zone means everyone has a body. */
  update(t: number | undefined, zone?: BodyZone): void;
  /** What each walking citizen's body says about itself (the L3 overlay). */
  l3Bodies(): readonly L3BodyReport[];
  /** Every citizen's agreed state at city time `cityMilliminutes`, computed
   * from scratch -- what the e2e agreement spec compares between clients. */
  agreementAt(cityMilliminutes: number): Promise<readonly LifeSample[]>;
  /** The bodies this client holds, solved at `cityMilliminutes` as they are:
   * what the divergence check compares between two different bubbles. */
  liveAt(cityMilliminutes: number): Promise<readonly LifeSample[]>;
  /** The same two reads for many instants in one round trip to the worker. */
  agreementAtMany(cityMilliminutes: readonly number[]): Promise<readonly (readonly LifeSample[])[]>;
  liveAtMany(cityMilliminutes: readonly number[]): Promise<readonly (readonly LifeSample[])[]>;
}

/** A citizen the layer draws: its sprite and its place in the street's life. */
interface Drawn {
  readonly sprite: Sprite;
  readonly frames: CompositeFrames;
  readonly member: ClientMember;
  /** Standing citizens keep their drawn position; walkers move. */
  readonly walks: boolean;
  /** Placed where its first solved frame says; until then it is not drawn. */
  placed: boolean;
}

/** A citizen of the street: its data, with or without a body. */
interface Citizen {
  readonly fixture: CitizenFixture;
  readonly override: UniformOverride | null;
  readonly family: Family;
  readonly spec: TimetableSpec | undefined;
  /** The ledger: a walker's legs. Absent for a standing citizen. */
  readonly ledger: Timetable | undefined;
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
  /** The zone of the first frame. No zone: everyone has a body. */
  options: { initialZone?: BodyZone; initialCityMilliminutes?: number } = {},
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
    ...(l3.rush?.fixtures ?? []),
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
  /** Declared to the worker in one message, for the agreement sample of every
   * citizen, with a body or not. */
  const declared: CitizenInit[] = [];
  for (const fixture of fixtures) {
    const override = fixture.professionKey ? resolveUniform(defs, fixture.professionKey) : null;
    const body = defs.bodies.find((b) => b.id === fixture.tuple.body);
    if (!body) throw new Error(`citizens-layer: no body def with id ${fixture.tuple.body}`);
    if (!layoutByFamily.get(body.family)) {
      throw new Error(`citizens-layer: no appearance layout for family '${body.family}'`);
    }
    const spec =
      WALKER_SPECS[fixture.id] ?? AVOIDANCE_SPECS[fixture.id] ?? l3.rush?.specs[fixture.id];
    const life = lifeDialsFor(defs, l3.config, body.family);
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
    declared.push({
      id: fixture.id,
      spec,
      walkMilli: ledger?.walkMilli,
      stand,
      standAt,
      look: appearanceCacheKey(fixture.tuple, override),
      life,
      gait: {
        strideCells: l3.config.strideCells,
        framesPerCycle: walkFramesPerCycle(defs, body.family),
      },
    });
    citizens.set(fixture.id, {
      fixture,
      override,
      family: body.family,
      spec,
      ledger,
      stand,
      standAt,
    });
  }

  l3.client.declare(declared);

  /** Builds a body from resolved frames. It is not drawn until the worker's
   * first result carries it, so it is never drawn anywhere but where its
   * ledger says it is at that instant. */
  function createBody(id: string, frames: CompositeFrames, _t: number): Drawn {
    const c = citizens.get(id) as Citizen;
    textureIdsById[id] = idFor(frames);
    const member = l3.client.add(id);
    // Not added to the layer, so not drawn, until a result carries it.
    const sprite = newBodySprite(frames, member.frame);
    const d: Drawn = { sprite, frames, member, walks: c.spec !== undefined, placed: false };
    drawn.set(id, d);
    rankDirty = true;
    return d;
  }

  /** Discards a body whole; nothing merges back. */
  function destroyBody(id: string, d: Drawn): void {
    layer.removeChild(d.sprite);
    d.sprite.destroy();
    l3.client.remove(d.member);
    drawn.delete(id);
    rankDirty = true;
  }

  const lifecycle = new BodyLifecycle<CompositeFrames, Drawn>(
    {
      acquire: (id) => {
        const c = citizens.get(id) as Citizen;
        return cache.acquire(c.fixture.tuple, c.override);
      },
      release: (id) => {
        const c = citizens.get(id) as Citizen;
        cache.release(c.fixture.tuple, c.override);
      },
      create: createBody,
      destroy: destroyBody,
    },
    // The cache is bounded and rejects on exhaustion: the citizen stays
    // without a body and tries again next frame while it is in the zone.
    (id, error) => console.warn(`citizens-layer: no body for ${id}`, error),
  );

  /** One reusable candidate per citizen: the ledger position, never a pose. */
  const citizenList: Citizen[] = [...citizens.values()];
  const candidates: BodyCandidate[] = citizenList.map((c) => ({
    id: c.fixture.id,
    x: c.fixture.gridX,
    y: c.fixture.gridY,
    floor: CROWD_FLOOR,
  }));
  const here: LedgerPoint = { x: 0, y: 0, floor: 0 };

  /** Runs the body zone at `t`; returns the spawns. */
  function applyZone(t: number, zone: BodyZone | undefined): Promise<void>[] {
    for (let i = 0; i < candidates.length; i++) {
      const c = citizenList[i] as Citizen;
      if (!c.ledger) continue;
      const cand = candidates[i] as BodyCandidate;
      ledgerPositionAt(c.ledger.stateAt(t), t, here);
      cand.x = here.x;
      cand.y = here.y;
      cand.floor = here.floor;
    }
    return lifecycle.apply(t, candidates, candidates.length, zone ?? WHOLE_ZONE);
  }

  // The bodies of the first frame are awaited, so the scene's first draw
  // shows them; later ones arrive as they walk into the zone.
  await Promise.all(applyZone(options.initialCityMilliminutes ?? 0, options.initialZone));

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
  const placed = { x: 0, y: 0 };
  function update(t: number | undefined, zone?: BodyZone): void {
    if (t !== undefined) applyZone(t, zone);
    if (rankDirty) {
      rankIds();
      rankDirty = false;
    }
    for (const d of drawn.values()) {
      const { frame } = d.member;
      if (!d.member.solved) continue;
      setBodyFrame(d.sprite, d.frames, frame);
      if (!d.placed) {
        d.placed = true;
        layer.addChild(d.sprite);
        // A standing citizen never moves, so it keeps its whole-world-pixel
        // placement (zoom 1, itself a whole screen pixel): its scatter
        // position is fractional, and a finer snap would only shift it.
        const first = worldPointPx(
          frame.x,
          frame.y,
          CROWD_FLOOR,
          tileSizePx,
          storeyHeightPx,
          d.walks ? zoom : 1,
          0,
        );
        d.sprite.x = first.x;
        d.sprite.y = first.y;
        d.sprite.zIndex = frame.y;
      }
      if (!d.walks || l3.frozen) continue;
      const ox = d.member.offsetX;
      const oy = d.member.offsetY;
      const px = worldPointPxInto(
        placed,
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
    bodyCount: () => lifecycle.bodies.size,
    citizenCount: citizenList.length,
    bodyBounds: () =>
      [...drawn].map(([id, d]) => {
        const b = d.sprite.getBounds();
        return { id, x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
      }),
    compareForE2e,
    update,
    agreementAt: (t) => l3.client.agreementAt(t),
    liveAt: (t) => l3.client.liveAt(t),
    agreementAtMany: (ts) => l3.client.agreementAtMany(ts),
    liveAtMany: (ts) => l3.client.liveAtMany(ts),
    l3Bodies: () => {
      const out: L3BodyReport[] = [];
      l3.client.wantDiagnostics();
      for (const d of drawn.values()) {
        const m = d.member;
        if (!m.solved) continue;
        // A body on a leg or showing a flavour, or with something to report.
        const flavour = m.frame.flavour;
        if (!m.frame.moving && !flavour && m.fallbacks === 0 && !m.paceOutOfBand) continue;
        const ox = m.offsetX;
        const oy = m.offsetY;
        out.push({
          id: m.id,
          x: m.frame.x + ox,
          y: m.frame.y + oy,
          floor: m.frame.floor,
          moving: m.frame.moving,
          fallbacks: m.fallbacks,
          paceOutOfBand: m.paceOutOfBand,
          avoidance: {
            // Positive to the right of the heading.
            offsetCells: ox * -m.frame.headingY + oy * m.frame.headingX,
            capped: m.capped,
            blocked: m.blocked,
          },
          activity: flavour || undefined,
        });
      }
      return out;
    },
  };
}
