// Story 4.8 (FR140, FR179, NFR4): `connect()` under the reconnect
// supervisor. Each attempt gets its own copy of the caller's callbacks,
// guarded by generation: once a newer connection exists, a late callback of
// an older one (a row, a status, the character, the region) reaches no
// consumer. `world/` and `render/` keep receiving plain insert, update and
// delete and never learn that a reconnect happened.
//
// Nothing here stores a row in steady state. The superseded connection's SDK
// cache (still readable after `disconnect()`) is kept only until the new
// connection's initial region has applied; during that window it says what
// consumers already hold (`reconcile.ts`).

import type { DbConnection } from "./bindings";
import { type ConnectOptions, connect, type RegionRow, type SessionIdentity } from "./connection";
import { reconcileInsert, unseenRows } from "./reconcile";
import { type SupervisorDeps, startSupervisor, type WakeTarget } from "./reconnect";
import { REGION_TABLE_NAMES, type RegionTableName, regionRowKey } from "./region-subscription";
import { type PlayerPositionRow, plainPlayerRow } from "./remote-rows";

export interface SupervisedEnv {
  /** The page's `window` and `document`, passed in by `main.ts`. */
  readonly window: WakeTarget;
  readonly document: WakeTarget & { readonly visibilityState: string };
  readonly setTimer?: SupervisorDeps<DbConnection>["setTimer"];
  readonly clearTimer?: SupervisorDeps<DbConnection>["clearTimer"];
  readonly random?: () => number;
}

export interface SupervisedConnection {
  /** The connection every caller must read at the moment of use. */
  current(): DbConnection;
  /** 1 while a connection is open, else 0. */
  liveCount(): number;
  wake(): void;
  stop(): void;
}

type Held<R> = Map<string, R>;

export function superviseConnect(
  options: ConnectOptions,
  env: SupervisedEnv,
): SupervisedConnection {
  let session: SessionIdentity | undefined;
  /** The newest connection opened so far. */
  let latest: DbConnection | undefined;
  /** Connections that ever delivered rows; a failed attempt holds nothing. */
  const connected = new WeakSet<DbConnection>();
  /** Superseded connections whose rows consumers may still hold, oldest
   * first, until a new connection's initial region has applied. */
  let superseded: DbConnection[] = [];
  let heldRows = new Map<RegionTableName, Held<RegionRow>>();
  let heldPlayers: Held<PlayerPositionRow> | undefined;
  let seenRows = new Map<RegionTableName, Set<string>>();
  let seenPlayers = new Set<string>();

  const rowsOf = (table: RegionTableName): Held<RegionRow> => {
    let held = heldRows.get(table);
    if (!held) {
      held = new Map();
      for (const old of superseded) {
        for (const row of old.db[table].iter()) held.set(regionRowKey(table, row), row);
      }
      heldRows.set(table, held);
    }
    return held;
  };
  const playersOf = (): Held<PlayerPositionRow> => {
    if (!heldPlayers) {
      heldPlayers = new Map();
      for (const old of superseded) {
        for (const row of old.db.playerPosition.iter()) {
          const plain = plainPlayerRow(row);
          heldPlayers.set(plain.characterId, plain);
        }
      }
    }
    return heldPlayers;
  };
  const seen = (table: RegionTableName): Set<string> => {
    let set = seenRows.get(table);
    if (!set) {
      set = new Set();
      seenRows.set(table, set);
    }
    return set;
  };
  const resetWindow = (): void => {
    heldRows = new Map();
    heldPlayers = undefined;
    seenRows = new Map();
    seenPlayers = new Set();
  };

  const open: SupervisorDeps<DbConnection>["open"] = (gen, report, live) => {
    const guard =
      <A extends unknown[]>(fn: ((...args: A) => void) | undefined) =>
      (...args: A): void => {
        if (live()) fn?.(...args);
      };
    const { region, clock } = options;
    const rows = region?.rows;
    const players = region?.players;
    // This attempt starts a new window: what the previous connection held,
    // and everything before it that was never swept, is what consumers hold.
    if (latest && connected.has(latest)) superseded.push(latest);
    resetWindow();
    const hasHeld = (): boolean => superseded.length > 0;

    // Assigned from the result below; `connected` only arrives after it.
    let next: DbConnection | undefined;
    next = connect({
      ...options,
      session,
      marks: gen === 1,
      onStatus: (status) => {
        if (!live()) return;
        if (status === "connected" && next) connected.add(next);
        report(status);
      },
      onPing: guard(options.onPing),
      onHandshake: guard(options.onHandshake),
      onIdentity: guard(options.onIdentity),
      onCharacter: guard(options.onCharacter),
      onSession: (s) => {
        if (live()) session ??= s;
      },
      clock: clock && { ...clock, onClock: guard(clock.onClock) },
      region: region && {
        ...region,
        controller: {
          attach: (backend, listener) => {
            if (live()) region.controller.attach(backend, listener);
          },
        },
        rows: rows && {
          onInsert: (table, row) => {
            if (!live()) return;
            const key = regionRowKey(table, row);
            seen(table).add(key);
            const held = hasHeld() ? rowsOf(table).get(key) : undefined;
            const outcome = reconcileInsert(held, row);
            if (outcome.kind === "insert") rows.onInsert(table, row);
            else if (outcome.kind === "update") rows.onUpdate(table, outcome.old, row);
          },
          onUpdate: (table, old, row) => {
            if (!live()) return;
            seen(table).add(regionRowKey(table, row));
            rows.onUpdate(table, old, row);
          },
          onDelete: (table, row) => {
            if (!live()) return;
            seen(table).add(regionRowKey(table, row));
            rows.onDelete(table, row);
          },
        },
        players: players && {
          onUpsert: (row) => {
            if (!live()) return;
            seenPlayers.add(row.characterId);
            const held = hasHeld() ? playersOf().get(row.characterId) : undefined;
            if (reconcileInsert(held, row).kind !== "none") players.onUpsert(row);
          },
          onRemove: (id) => {
            if (!live()) return;
            seenPlayers.add(id);
            players.onRemove(id);
          },
        },
        onInitialApplied: () => {
          if (!live()) return;
          // The new region is in: whatever an older connection left behind
          // no longer exists.
          if (hasHeld()) {
            for (const table of REGION_TABLE_NAMES) {
              for (const row of unseenRows(rowsOf(table), seen(table))) rows?.onDelete(table, row);
            }
            for (const row of unseenRows(playersOf(), seenPlayers)) {
              players?.onRemove(row.characterId);
            }
          }
          superseded = [];
          resetWindow();
          region.onInitialApplied?.();
        },
      },
    });
    latest = next;
    return next;
  };

  return startSupervisor<DbConnection>({
    open,
    probe: (conn) => conn.procedures.syncClock({}),
    isClosed: (conn) => conn.isSocketClosed,
    close: (conn) => conn.disconnect(),
    onStatus: (status) => options.onStatus?.(status),
    setTimer: env.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: env.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    random: env.random ?? Math.random,
    window: env.window,
    document: env.document,
  });
}
