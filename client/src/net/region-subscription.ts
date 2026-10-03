// Interest management (FR136, FR58, FR145): the client holds one
// subscription handle per (chunk column, floor band) around the player and
// nothing else. `world/region.ts` decides which handles; this module turns
// that plan into subscriptions and keeps the handle accounting honest.
//
// Columns are disjoint, so a shifting region re-sends nothing and no
// "subscribe the new before releasing the old" ordering is needed. A
// handle is only ever released once it has applied -- `unsubscribe()`
// throws on a handle that is pending or has ended -- so a handle no longer
// wanted while still pending is released from its own `onApplied`. The
// recompute runs only when the player's chunk column or floor band
// changes, never per frame.
//
// `net/` is the only importer of binding values: `sdkRegionBackend` is the
// one place a query is built, and it is the typed builder with a single
// equality per query -- never a string, never a range, never an `OR`.

import {
  type Band,
  bandOf,
  chunkKeysOfHandle,
  columnOf,
  type FloorRange,
  type HandleKey,
  handleId,
  planRegion,
} from "../world/region";
import type { DbConnection } from "./bindings";
import { tables } from "./bindings";

/** A handle ends on exactly one of `onEnded` or `onError`, whichever comes
 * first; `onError` can arrive in any state, unsubscribing included. */
export interface HandleCallbacks {
  onApplied(): void;
  /** The handle's unsubscribe completed. */
  onEnded(): void;
  onError(message: string): void;
}

/** What the manager needs of an SDK handle: `unsubscribe` is valid only
 * once the handle has applied, and only once. */
export interface RegionHandle {
  unsubscribe(): void;
}

/** The seam the SDK sits behind, so a fake can replace it. */
export interface RegionBackend {
  subscribe(key: HandleKey, range: FloorRange, callbacks: HandleCallbacks): RegionHandle;
}

export interface RegionListener {
  /** A region subscription failed -- routed to the connection status. */
  onError(message: string): void;
  onApplied?(key: HandleKey): void;
  /** Every handle the first position asked for has applied: the initial
   * region is in. Fires once per manager. */
  onInitialApplied?(): void;
}

type HandleState = "requested" | "applied";

interface Entry {
  readonly key: HandleKey;
  /** Assigned once `backend.subscribe` returns; a backend may apply
   * synchronously, before that. */
  handle?: RegionHandle;
  state: HandleState;
  /** No longer wanted while still requested: released on `onApplied`. */
  releaseWhenApplied: boolean;
}

export class RegionSubscriptions {
  private readonly entries = new Map<string, Entry>();
  /** Handles unsubscribed that have neither ended nor errored yet. */
  private readonly ending = new Set<Entry>();
  private lastColumn: { cx: number; cy: number; band: Band } | undefined;
  private failed = false;
  private initial: Set<string> | undefined;

  constructor(
    private readonly backend: RegionBackend,
    private readonly range: FloorRange,
    private readonly listener: RegionListener,
  ) {}

  /** Called with the player's position as it changes; does nothing unless
   * the player's chunk column or floor band differs from the last call. */
  moveTo(x: number, y: number, floor: number): void {
    if (this.failed) return;
    const { cx, cy } = columnOf(x, y);
    const band = bandOf(floor);
    const last = this.lastColumn;
    if (last && last.cx === cx && last.cy === cy && last.band === band) return;
    this.lastColumn = { cx, cy, band };

    const plan = planRegion(this.wanted(), { x, y, floor });
    for (const key of plan.release) this.release(key);
    const first = this.initial === undefined;
    if (first) this.initial = new Set(plan.subscribe.map(handleId));
    for (const key of plan.subscribe) this.request(key);
  }

  /** Handles created and not yet ended, ending ones included. */
  liveHandleCount(): number {
    return this.entries.size + this.ending.size;
  }

  /** The handles currently wanted. */
  heldKeys(): HandleKey[] {
    return this.wanted();
  }

  /** The wanted handles whose initial apply has landed. */
  appliedKeys(): HandleKey[] {
    const out: HandleKey[] = [];
    for (const e of this.entries.values()) {
      if (!e.releaseWhenApplied && e.state === "applied") out.push(e.key);
    }
    return out;
  }

  private wanted(): HandleKey[] {
    const out: HandleKey[] = [];
    for (const e of this.entries.values()) if (!e.releaseWhenApplied) out.push(e.key);
    return out;
  }

  private request(key: HandleKey): void {
    const id = handleId(key);
    const existing = this.entries.get(id);
    if (existing) {
      // Wanted again while its release was still waiting on `onApplied`.
      existing.releaseWhenApplied = false;
      return;
    }
    const entry: Entry = { key, state: "requested", releaseWhenApplied: false };
    this.entries.set(id, entry);
    entry.handle = this.backend.subscribe(key, this.range, {
      onApplied: () => this.applied(id, entry),
      onEnded: () => {
        this.ending.delete(entry);
      },
      onError: (message) => this.errored(id, entry, message),
    });
  }

  private release(key: HandleKey): void {
    const id = handleId(key);
    const entry = this.entries.get(id);
    if (!entry || entry.releaseWhenApplied) return;
    if (entry.state === "requested") {
      entry.releaseWhenApplied = true;
      return;
    }
    this.unsubscribe(id, entry);
  }

  private applied(id: string, entry: Entry): void {
    if (this.entries.get(id) !== entry) return;
    entry.state = "applied";
    if (entry.releaseWhenApplied) this.unsubscribe(id, entry);
    else this.listener.onApplied?.(entry.key);
    // A first-region handle settles when it applies, wanted or not.
    if (this.initial?.delete(id) && this.initial.size === 0) this.listener.onInitialApplied?.();
  }

  private unsubscribe(id: string, entry: Entry): void {
    if (!entry.handle) throw new Error(`region handle ${id} applied before it was returned`);
    this.entries.delete(id);
    this.ending.add(entry);
    entry.handle.unsubscribe();
  }

  private errored(id: string, entry: Entry, message: string): void {
    if (this.entries.get(id) === entry) this.entries.delete(id);
    this.ending.delete(entry);
    this.failed = true;
    this.listener.onError(message);
  }
}

/** Survives a connection: holds the player's latest position and the
 * floor range, and builds a fresh `RegionSubscriptions` for each
 * connection, so a reconnect re-subscribes around where the player is
 * now, not where they spawned. Holds nothing until it has a floor range
 * (from the defs), a backend (a connection) and a position. */
export class RegionController {
  private range: FloorRange | undefined;
  private position: { x: number; y: number; floor: number } | undefined;
  private backend: { backend: RegionBackend; listener: RegionListener } | undefined;
  private current: RegionSubscriptions | undefined;

  configure(range: FloorRange): void {
    this.range = range;
    this.rebuild();
  }

  attach(backend: RegionBackend, listener: RegionListener): void {
    this.backend = { backend, listener };
    this.current = undefined;
    this.rebuild();
  }

  moveTo(x: number, y: number, floor: number): void {
    this.position = { x, y, floor };
    this.current?.moveTo(x, y, floor);
    this.rebuild();
  }

  subscriptions(): RegionSubscriptions | undefined {
    return this.current;
  }

  private rebuild(): void {
    if (this.current || !this.range || !this.backend || !this.position) return;
    this.current = new RegionSubscriptions(this.backend.backend, this.range, this.backend.listener);
    this.current.moveTo(this.position.x, this.position.y, this.position.floor);
  }
}

/** The one declaration of what the region streams: a table is added here
 * and nowhere else. Each entry is the one query shape the region ever
 * issues, `chunk_key = <chunk>`, built with the typed builder. */
export const REGION_QUERIES = {
  placedObject: (k: bigint) => tables.placedObject.where((r) => r.chunkKey.eq(k)).build(),
  floorTransition: (k: bigint) => tables.floorTransition.where((r) => r.chunkKey.eq(k)).build(),
  buildingArea: (k: bigint) => tables.buildingArea.where((r) => r.chunkKey.eq(k)).build(),
  roomArea: (k: bigint) => tables.roomArea.where((r) => r.chunkKey.eq(k)).build(),
  actorLocation: (k: bigint) => tables.actorLocation.where((r) => r.chunkKey.eq(k)).build(),
} as const;

/** The tables the region streams, by accessor name. */
export type RegionTableName = keyof typeof REGION_QUERIES;

export const REGION_TABLE_NAMES = Object.keys(REGION_QUERIES) as RegionTableName[];

/** The queries one handle holds: for every table and every floor of its
 * band, `chunk_key = <that chunk>` -- one pure equality, never anything
 * else, so the engine can parameterise and share it. */
export function regionQueries(key: HandleKey, range: FloorRange) {
  const chunkKeys = chunkKeysOfHandle(key, range);
  return Object.values(REGION_QUERIES).flatMap((query) => chunkKeys.map((k) => query(k)));
}

/** The SDK backend: one `subscribe` per handle with its typed queries. */
export function sdkRegionBackend(conn: DbConnection): RegionBackend {
  return {
    subscribe(key, range, cb) {
      const handle = conn
        .subscriptionBuilder()
        .onApplied(() => cb.onApplied())
        .onError((ctx) => {
          console.error("[net] region subscription failed", ctx.event);
          cb.onError(String(ctx.event));
        })
        .subscribe(regionQueries(key, range));
      return {
        unsubscribe: () => handle.unsubscribeThen(() => cb.onEnded()),
      };
    },
  };
}

/** `chunk_key` of every row of `table` in the SDK client cache -- the
 * cache is the only store of streamed rows, so this is what "the client
 * holds" means. */
export function cachedChunkKeys(conn: DbConnection, table: RegionTableName): string[] {
  return [...conn.db[table].iter()].map((row) => String(row.chunkKey));
}
