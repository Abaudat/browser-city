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

/**
 * Opens the connection, subscribes to `demo_ping`, and calls `onPing` for
 * every row observed through the SDK's `onInsert` callback -- including
 * rows already present when the subscription applies, so a client that
 * connects after the write still observes it.
 */
export function connect(onPing: PingListener): DbConnection {
  // A real player never carries this: no code anywhere links to a page
  // with `?bc-token=` on it. `client/tests/e2e/deploy-smoke.spec.ts`
  // (both against a live Maincloud database and against the disposable
  // local one `ci.yml`'s `e2e` job rehearses it with) is the one caller
  // that ever sets it, so the post-deploy smoke check reconnects as the
  // same fixed identity every run instead of minting a fresh one that
  // would otherwise slowly pollute the production world (NFR39). Absent,
  // `withToken(undefined)` is exactly today's behaviour: a fresh
  // server-issued identity, every load.
  const token = new URLSearchParams(window.location.search).get("bc-token") ?? undefined;
  const conn = DbConnection.builder()
    .withUri(NET_CONFIG.uri)
    .withDatabaseName(NET_CONFIG.databaseName)
    .withToken(token)
    .onConnect((connection) => {
      // Story 1.14 (NFR1): the handshake term ends here, and the
      // subscription-decode term ends at this subscription's own
      // `onApplied` -- the two are never conflated under one mark.
      markBoot(BOOT_MARK.HANDSHAKE_OPEN);
      connection
        .subscriptionBuilder()
        .onApplied(() => markBoot(BOOT_MARK.SUBSCRIPTION_APPLIED))
        .subscribe("SELECT * FROM demo_ping");
    })
    .onConnectError((_ctx, error) => {
      // NFR42: the client degrades to not-drawing, never to crashing.
      console.error("[net] connection failed", error);
    })
    .build();

  conn.db.demoPing.onInsert((_ctx, row) => {
    onPing(observePingInsert(row));
  });

  return conn;
}
