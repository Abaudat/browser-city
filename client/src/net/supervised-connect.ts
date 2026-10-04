// Story 4.8 (FR140, FR179, NFR4): `connect()` under the reconnect
// supervisor. Each attempt gets its own copy of the caller's callbacks,
// guarded by generation: once a newer connection exists, a late callback of
// an older one (a row, a status, the character, the region) reaches no
// consumer. Rows are reconciled across generations (`reconcile.ts`), so
// `world/` and `render/` keep receiving plain insert, update and delete and
// never learn that a reconnect happened.

import type { DbConnection } from "./bindings";
import {
  type ConnectOptions,
  connect,
  type RegionRow,
  type RegionTableName,
  type SessionIdentity,
} from "./connection";
import { GenerationStore } from "./reconcile";
import { type SupervisorDeps, startSupervisor, type WakeTarget } from "./reconnect";
import { REGION_TABLE_NAMES } from "./region-subscription";
import type { PlayerPositionRow } from "./remote-rows";

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

/** Every region table's first column is its primary key. */
const rowKey = (row: RegionRow): string => String(Object.values(row)[0]);

export function superviseConnect(
  options: ConnectOptions,
  env: SupervisedEnv,
): SupervisedConnection {
  let session: SessionIdentity | undefined;
  const rowStores = new Map<RegionTableName, GenerationStore<RegionRow>>(
    REGION_TABLE_NAMES.map((name) => [name, new GenerationStore<RegionRow>(rowKey)]),
  );
  const playerStore = new GenerationStore<PlayerPositionRow>((r) => r.characterId);

  const open: SupervisorDeps<DbConnection>["open"] = (gen, report, live) => {
    const guard =
      <A extends unknown[]>(fn: ((...args: A) => void) | undefined) =>
      (...args: A): void => {
        if (live()) fn?.(...args);
      };
    const { region, clock } = options;
    const store = (table: RegionTableName) => rowStores.get(table) as GenerationStore<RegionRow>;
    const rows = region?.rows;
    const players = region?.players;
    return connect({
      ...options,
      session,
      marks: gen === 1,
      onStatus: (status) => {
        if (live()) report(status);
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
            const outcome = store(table).insert(gen, row);
            if (outcome.kind === "insert") rows.onInsert(table, row);
            else if (outcome.kind === "update") rows.onUpdate(table, outcome.old, row);
          },
          onUpdate: (table, old, row) => {
            if (!live()) return;
            store(table).update(gen, row);
            rows.onUpdate(table, old, row);
          },
          onDelete: (table, row) => {
            if (!live()) return;
            store(table).remove(row);
            rows.onDelete(table, row);
          },
        },
        players: players && {
          onUpsert: (row) => {
            if (live() && playerStore.insert(gen, row).kind !== "none") players.onUpsert(row);
          },
          onRemove: (id) => {
            if (!live()) return;
            playerStore.removeKey(id);
            players.onRemove(id);
          },
        },
        onInitialApplied: () => {
          if (!live()) return;
          // The new region is in: whatever an older connection left behind
          // no longer exists.
          for (const [table, held] of rowStores) {
            for (const row of held.sweep(gen)) rows?.onDelete(table, row);
          }
          for (const row of playerStore.sweep(gen)) players?.onRemove(row.characterId);
          region.onInitialApplied?.();
        },
      },
    });
  };

  const supervisor = startSupervisor<DbConnection>({
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
  return supervisor;
}
