// Story 1.10 (AC5, FR61/FR62): the one adapter that turns a crowd's
// fixtures (supplied by the caller: a DEV harness today, L2's citizens
// from Epic 5) into real, mounted sprites through the real appearance
// pipeline. Never part of `world-scene.ts`'s own depth-sorted
// `characters` pool; this module only ever populates the floor-0
// container the scene already created, registered as a visibility member
// and attached under `render/floor-stacks.ts`'s own floor-0 stack before
// this function is even called (story 15.8). Takes its
// `AppearanceTextureCache` from the caller rather than building its own,
// so the player's own sprite and the crowd share one cache. Excluded from
// `client/vitest.config.ts`'s coverage gate alongside the other
// real-Pixi adapters it composes.

import { Container, type Sprite } from "pixi.js";
import type { Defs, Family } from "../defs/types";
import { type AtState, CitizenBody } from "../l3/citizen";
import { type L3Config, pathConfigOf, walkFramesPerCycle } from "../l3/config";
import type { Facing } from "../l3/gait";
import { Timetable, type TimetableSpec } from "../l3/interim-timetable";
import { type LedgerPoint, ledgerPositionAt } from "../l3/ledger-position";
import type { Walkability } from "../l3/micro-path";
import {
  type LifeMember,
  type LifeSample,
  lifeDialsFor,
  type StreetLife,
  standState,
} from "./street-life";
import { BodyLifecycle } from "../world/body-lifecycle";
import { type BodyCandidate, type BodyZone, WHOLE_ZONE } from "../world/body-zone";
import { cellOf } from "../world/ownership";
import type {
  AppearanceTextureCache,
  CompositeFrames,
} from "./appearance/appearance-texture";
import {
  type AppearanceTuple,
  appearanceCacheKey,
  resolveUniform,
  type UniformOverride,
} from "./appearance/composite";
import { newBodySprite, setBodyFrame } from "./body-sprite";
import { worldPointPx, worldPointPxInto } from "./screen-position";

/** The floor every crowd body lives on. */
export const CROWD_FLOOR = 0;

/** One citizen of a crowd: who it looks like and where it stands (or
 * starts). */
export interface CitizenFixture {
  readonly id: string;
  readonly tuple: AppearanceTuple;
  /** FR62: resolved through `resolveUniform` at mount time. */
  readonly professionKey?: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly facing: string;
}

/** A crowd to mount: its citizens and the timetable of each that walks. */
export interface CrowdSource {
  readonly fixtures: readonly CitizenFixture[];
  readonly specs: Readonly<Record<string, TimetableSpec>>;
}

/** What the walking citizens need from L3: tile walkability and the dials. */
export interface WalkerSource {
  readonly walk: Walkability;
  readonly config: L3Config;
  /** Every ledger-driven citizen on the street, the layer's own included. */
  readonly life: StreetLife;
  /** The citizens to draw. */
  readonly crowd: CrowdSource;
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
  agreementAt(cityMilliminutes: number): readonly LifeSample[];
  /** The bodies this client holds, solved at `cityMilliminutes` as they are:
   * what the divergence check compares between two different bubbles. */
  liveAt(cityMilliminutes: number): readonly LifeSample[];
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
  l3: WalkerSource,
  /** The zone of the first frame. No zone: everyone has a body. */
  options: { initialZone?: BodyZone; initialCityMilliminutes?: number } = {},
): Promise<CitizensLayerHandle> {
  const layer = new Container();
  layer.sortableChildren = true;
  parent.addChild(layer);

  const fixtures = l3.crowd.fixtures;
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
    const spec = l3.crowd.specs[fixture.id];
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
      look: appearanceCacheKey(fixture.tuple, override),
      remake: make,
    });
    citizens.set(fixture.id, {
      fixture,
      override,
      family: body.family,
      spec,
      ledger,
      make,
      stand,
      standAt,
    });
  }

  /** Builds a body from resolved frames, posed once at the spawn instant
   * `t` -- where its ledger says it is, never its fixture's home cell -- so
   * it is never drawn anywhere else. */
  function createBody(id: string, frames: CompositeFrames, t: number): Drawn {
    const c = citizens.get(id) as Citizen;
    const { fixture, override } = c;
    textureIdsById[id] = idFor(frames);
    const member = l3.life.add({
      id,
      ...c.make(),
      stand: c.stand,
      standAt: c.standAt,
      look: appearanceCacheKey(fixture.tuple, override),
      remake: c.make,
    });
    l3.life.pose(member, t);
    const sprite = newBodySprite(frames, member.frame);
    const walks = c.spec !== undefined;
    // A standing citizen never moves, so it keeps its whole-world-pixel
    // placement (zoom 1, itself a whole screen pixel): its scatter
    // position is fractional, and a finer snap would only shift it.
    const px = worldPointPx(
      member.frame.x,
      member.frame.y,
      CROWD_FLOOR,
      tileSizePx,
      storeyHeightPx,
      walks ? zoom : 1,
      0,
    );
    sprite.x = px.x;
    sprite.y = px.y;
    sprite.zIndex = member.frame.y;
    layer.addChild(sprite);
    const d: Drawn = { sprite, frames, member, walks };
    drawn.set(id, d);
    rankDirty = true;
    return d;
  }

  /** Discards a body whole; nothing merges back. */
  function destroyBody(id: string, d: Drawn): void {
    layer.removeChild(d.sprite);
    d.sprite.destroy();
    l3.life.remove(d.member);
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
      setBodyFrame(d.sprite, d.frames, frame);
      if (!d.walks) continue;
      const ox = l3.life.offsetX(d.member);
      const oy = l3.life.offsetY(d.member);
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
    update,
    agreementAt: (t) => l3.life.agreementAt(t),
    liveAt: (t) => l3.life.liveAt(t),
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
          moving: m.frame.moving,
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
