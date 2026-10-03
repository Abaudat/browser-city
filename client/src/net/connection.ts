// `DbConnection` and every generated type stay confined to `client/src/net/`
// (Tim, story 1.1); nothing under `render/` imports from `bindings/`. This
// module is the only caller of the generated bindings and exposes plain
// data and a plain callback, never the SDK's own types, to the rest of the
// client.

import { BOOT_MARK, markBoot } from "../boot/boot-marks";
import type { HandshakeVersion } from "../boot/handshake";
import type { ClockSync } from "../time/clock-sync";
import type { ServerClock } from "../time/server-clock";
import { DbConnection, tables } from "./bindings";
import type {
  ActorLocation,
  BuildingArea,
  FloorTransition,
  PlacedObject,
  RoomArea,
} from "./bindings/types";
import { startNetClockSync, type VisibilitySource } from "./clock-sync";
import { NET_CONFIG } from "./config";
import type { ConnectionStatus } from "./connection-status";
import { observePingInsert, type PingObservation } from "./observe-ping";
import {
  REGION_TABLE_NAMES,
  type RegionController,
  type RegionTableName,
  sdkRegionBackend,
} from "./region-subscription";

export type { HandshakeVersion } from "../boot/handshake";
export type { ConnectionStatus } from "./connection-status";
export type { RegionTableName } from "./region-subscription";

export type PingListener = (observation: PingObservation) => void;

export type StatusListener = (status: ConnectionStatus) => void;

/** Story 2.8 (FR147): fired with the `module_version` view row's own
 * `defsVersion`/`protocolVersion` every time it (re-)inserts -- on the
 * initial subscription apply, and again on any later republish this
 * connection stays open across (a tab left open across a deploy). */
export type HandshakeListener = (version: HandshakeVersion) => void;

/** Story 4.1 (FR1-FR3): what the in-city clock needs from the connection --
 * the shared skew estimate the sync round trips feed, and the clock row's
 * `epoch_at` (microseconds since the Unix epoch) and `speed` multiplier on
 * insert and on any later rewrite. */
export interface ClockWiring {
  readonly serverClock: ServerClock;
  /** The page's `document`, passed in by `main.ts` (DOM globals stay out
   * of `net/`). */
  readonly visibility: VisibilitySource;
  readonly onClock: (
    clock: { epochMicros: bigint; speed: number },
    kind: "insert" | "update",
  ) => void;
}

export type RegionRow = PlacedObject | FloorTransition | BuildingArea | RoomArea | ActorLocation;

/** Streamed rows as plain data, registered once per table. The SDK client
 * cache stays the only store of them: nothing here keeps a second copy. */
export interface RegionRowListener {
  onInsert(table: RegionTableName, row: RegionRow): void;
  onUpdate(table: RegionTableName, oldRow: RegionRow, row: RegionRow): void;
  onDelete(table: RegionTableName, row: RegionRow): void;
}

/** Story 4.3: the interest region. `controller` owns the player's
 * position and the floor range; every connection attaches a fresh backend
 * to it. */
export interface RegionWiring {
  readonly controller: RegionController;
  readonly rows?: RegionRowListener;
}

/**
 * Opens the connection, subscribes to `demo_ping`, and calls `onPing` for
 * every row observed through the SDK's `onInsert` callback -- including
 * rows already present when the subscription applies, so a client that
 * connects after the write still observes it.
 *
 * `onStatus`, if given, is called once synchronously with `"connecting"`
 * before the builder's own callbacks are wired, then `"connected"` on a
 * successful handshake and `"disconnected"` on either a connect error or
 * a later drop (`onDisconnect`) -- the two paths story 1.11's connection
 * notice must both show for (a boot-time failure and a drop after a
 * successful connect are otherwise indistinguishable from this module's
 * only two ways of reaching "not connected").
 */
export function connect(
  onPing: PingListener,
  onStatus?: StatusListener,
  onHandshake?: HandshakeListener,
  clock?: ClockWiring,
  region?: RegionWiring,
): DbConnection {
  onStatus?.("connecting");
  let clockSync: ClockSync | undefined;
  // The whole-table subscription is three singletons; the world arrives
  // through the region. `SUBSCRIPTION_APPLIED` keeps meaning the first
  // subscription's own decode term; `REGION_APPLIED` is the initial
  // region's.

  const conn = DbConnection.builder()
    .withUri(NET_CONFIG.uri)
    .withDatabaseName(NET_CONFIG.databaseName)
    .onConnect((connection) => {
      // Story 1.14 (NFR1): the handshake term ends here, and the
      // subscription-decode term ends at this subscription's own
      // `onApplied` -- the two are never conflated under one mark.
      markBoot(BOOT_MARK.HANDSHAKE_OPEN);
      onStatus?.("connected");
      // Story 2.8 (FR147): `module_version` rides the same subscribe
      // call as `demo_ping` -- one subscribe message, one `onApplied`, no
      // extra round trip on the common (matched-version) path.
      connection
        .subscriptionBuilder()
        .onApplied(() => markBoot(BOOT_MARK.SUBSCRIPTION_APPLIED))
        .onError((ctx) => {
          // Cycle 1 review (Tim's finding 6): with no `onError`, a
          // rejected subscribe left the boot gate's own handshake latch
          // waiting forever -- a blank canvas, no notice, worse than
          // before this story. Reusing `onStatus("disconnected")` is
          // deliberate: `main.ts` already resolves the latch as
          // unreachable on that status, so this needs no new callback.
          console.error("[net] subscription failed", ctx.event);
          onStatus?.("disconnected");
        })
        .subscribe([
          tables.demoPing.build(),
          tables.moduleVersion.build(),
          tables.worldClock.build(),
        ]);
      // Story 4.3: a new connection is a new region manager, built around
      // the player's current position.
      region?.controller.attach(sdkRegionBackend(connection), {
        onError: () => onStatus?.("disconnected"),
        onInitialApplied: () => markBoot(BOOT_MARK.REGION_APPLIED),
      });
      // Story 4.1: the first stamped round trip rides the same connect
      // moment; a reconnect is a new `connect()` and so a new sync.
      if (clock) clockSync = startNetClockSync(connection, clock.serverClock, clock.visibility);
    })
    .onConnectError((_ctx, error) => {
      // NFR42: the client degrades to not-drawing, never to crashing.
      console.error("[net] connection failed", error);
      onStatus?.("disconnected");
    })
    .onDisconnect((_ctx, error) => {
      // A drop after a successful connect -- the world keeps its last
      // known state by construction (story 1.11, Tim's direction): this
      // callback touches nothing but status, never the Pixi Application,
      // the scene, its ticker or any pool.
      if (error) console.error("[net] connection dropped", error);
      clockSync?.stop();
      onStatus?.("disconnected");
    })
    .build();

  conn.db.demoPing.onInsert((_ctx, row) => {
    onPing(observePingInsert(row));
  });

  // Story 2.8 (FR147): `module_version` has no primary key (it is a
  // view, not a table -- `server/src/version.rs`), so a change to its one
  // row arrives as a delete-then-insert pair, never an `onUpdate`; this
  // `onInsert` alone covers both the initial subscription apply and any
  // later republish.
  conn.db.moduleVersion.onInsert((_ctx, row) => {
    onHandshake?.({ defsVersion: row.defsVersion, protocolVersion: row.protocolVersion });
  });

  const rows = region?.rows;
  if (rows) {
    for (const name of REGION_TABLE_NAMES) {
      const table = conn.db[name];
      table.onInsert((_ctx, row) => rows.onInsert(name, row));
      table.onUpdate((_ctx, oldRow, row) => rows.onUpdate(name, oldRow, row));
      table.onDelete((_ctx, row) => rows.onDelete(name, row));
    }
  }

  if (clock) {
    // `world_clock` is subscribed (not merely read once) so an FR163 epoch
    // rewrite reaches a running client without a reload.
    conn.db.worldClock.onInsert((_ctx, row) => {
      clock.onClock({ epochMicros: row.epochAt.microsSinceUnixEpoch, speed: row.speed }, "insert");
    });
    conn.db.worldClock.onUpdate((_ctx, _old, row) => {
      clock.onClock({ epochMicros: row.epochAt.microsSinceUnixEpoch, speed: row.speed }, "update");
    });
  }

  return conn;
}
