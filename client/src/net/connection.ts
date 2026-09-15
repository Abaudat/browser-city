// `DbConnection` and every generated type stay confined to `client/src/net/`
// (Tim, story 1.1); nothing under `render/` imports from `bindings/`. This
// module is the only caller of the generated bindings and exposes plain
// data and a plain callback, never the SDK's own types, to the rest of the
// client.

import { BOOT_MARK, markBoot } from "../boot/boot-marks";
import { DbConnection } from "./bindings";
import { NET_CONFIG } from "./config";
import { observePingInsert, type PingObservation } from "./observe-ping";

export type PingListener = (observation: PingObservation) => void;

/** A plain string union -- never an SDK type, never the SDK's own error
 * object, leaking past this file (story 1.11, Tim's direction).
 * `"reconnecting"` is deliberately not a member yet: this story does not
 * implement reconnection (story 4.16's FR179/FR140/NFR4 work); the union
 * is built so that story adds the member without reshaping this one. */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type StatusListener = (status: ConnectionStatus) => void;

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
export function connect(onPing: PingListener, onStatus?: StatusListener): DbConnection {
  onStatus?.("connecting");

  const conn = DbConnection.builder()
    .withUri(NET_CONFIG.uri)
    .withDatabaseName(NET_CONFIG.databaseName)
    .onConnect((connection) => {
      // Story 1.14 (NFR1): the handshake term ends here, and the
      // subscription-decode term ends at this subscription's own
      // `onApplied` -- the two are never conflated under one mark.
      markBoot(BOOT_MARK.HANDSHAKE_OPEN);
      onStatus?.("connected");
      connection
        .subscriptionBuilder()
        .onApplied(() => markBoot(BOOT_MARK.SUBSCRIPTION_APPLIED))
        .subscribe("SELECT * FROM demo_ping");
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
      onStatus?.("disconnected");
    })
    .build();

  conn.db.demoPing.onInsert((_ctx, row) => {
    onPing(observePingInsert(row));
  });

  return conn;
}
