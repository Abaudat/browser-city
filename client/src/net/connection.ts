// `DbConnection` and every generated type stay confined to `client/src/net/`
// (Tim, story 1.1); nothing under `render/` imports from `bindings/`. This
// module is the only caller of the generated bindings and exposes plain
// data and a plain callback, never the SDK's own types, to the rest of the
// client.

import { BOOT_MARK, markBoot } from "../boot/boot-marks";
import type { HandshakeVersion } from "../boot/handshake";
import { readStoredToken, rememberFirstToken } from "../identity/identity-storage";
import type { SettingsStorage } from "../settings/settings-storage";
import type { ClockSync } from "../time/clock-sync";
import type { ServerClock } from "../time/server-clock";
import { DbConnection } from "./bindings";
import { startNetClockSync, type VisibilitySource } from "./clock-sync";
import { NET_CONFIG } from "./config";
import type { ConnectionStatus } from "./connection-status";
import { observePingInsert, type PingObservation } from "./observe-ping";

export type { HandshakeVersion } from "../boot/handshake";
export type { ConnectionStatus } from "./connection-status";

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

/** Story 4.5 (FR141): who this device is, reported once per connection --
 * `persisted` is whether the token is in storage (a character must never
 * be created for an identity that could not be kept). */
export interface IdentityReport {
  readonly identityHex: string;
  readonly persisted: boolean;
}

/** Story 4.5: the caller's own character, from the per-sender
 * `my_character` view -- `linked` once any of its identities came through
 * an OIDC issuer. */
export interface CharacterReport {
  readonly characterId: bigint;
  readonly createdAtMicros: bigint;
  readonly linked: boolean;
}

export interface ConnectOptions {
  readonly onPing: PingListener;
  readonly onStatus?: StatusListener;
  readonly onHandshake?: HandshakeListener;
  readonly clock?: ClockWiring;
  /** Where the identity token lives; none means a session-only identity. */
  readonly storage?: SettingsStorage | null;
  readonly onIdentity?: (identity: IdentityReport) => void;
  readonly onCharacter?: (character: CharacterReport) => void;
  /** The first subscription apply: every table's initial rows, the player's
   * own character included, have been delivered. */
  readonly onApplied?: () => void;
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

/**
 * Story 4.5 (FR141): the stored token, if any, is presented with
 * `withToken`; a first visit takes the one the server issues in the
 * handshake and stores it. The stored token is never replaced or removed by
 * a failure of any kind: a refused token shows the connection notice and
 * keeps the token, it never falls back to a fresh anonymous identity. A
 * tab that finds another tab's token already stored keeps its own
 * connection as a session-only identity (`persisted: false`).
 */
export function connect(options: ConnectOptions): DbConnection {
  options.onStatus?.("connecting");
  const { onPing, onStatus, onHandshake, clock, storage, onIdentity, onCharacter, onApplied } =
    options;
  let clockSync: ClockSync | undefined;

  const stored = readStoredToken(storage);
  const base = DbConnection.builder()
    .withUri(NET_CONFIG.uri)
    .withDatabaseName(NET_CONFIG.databaseName);
  const conn = (stored === null ? base : base.withToken(stored))
    .onConnect((connection, identity, token) => {
      if (stored === null) {
        const outcome = rememberFirstToken(storage, token);
        onIdentity?.({ identityHex: identity.toHexString(), persisted: outcome.kind === "stored" });
      } else {
        onIdentity?.({ identityHex: identity.toHexString(), persisted: true });
      }
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
        .onApplied(() => {
          markBoot(BOOT_MARK.SUBSCRIPTION_APPLIED);
          onApplied?.();
        })
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
          "SELECT * FROM demo_ping",
          "SELECT * FROM module_version",
          "SELECT * FROM world_clock",
          "SELECT * FROM my_character",
        ]);
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

  // `my_character` is a per-sender view without a primary key: a change
  // arrives as a delete-then-insert pair, so `onInsert` alone covers it.
  conn.db.myCharacter.onInsert((_ctx, row) => {
    onCharacter?.({
      characterId: row.characterId,
      createdAtMicros: row.createdAt.microsSinceUnixEpoch,
      linked: row.linked,
    });
  });

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
