// Story 4.5 (FR143): the two plain functions `net/` exposes for linking an
// OIDC identity to this device's character, so the generated bindings stay
// confined here. Linking is one operation: this device's anonymous identity
// stores a one-time code (`beginLink`), the player signs in at the
// provider, and the OIDC identity redeems it on a second, short-lived
// connection (`completeLinkWithIdToken`). The everyday connection never
// uses the ID token.

import { DbConnection } from "./bindings";
import { NET_CONFIG } from "./config";

type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;

/** A fresh 256-bit link code, hex-encoded. */
export function newLinkCode(random: RandomSource = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The slice of a connection `beginLink` uses. */
interface LinkReducers {
  readonly reducers: { beginLink(p: { code: string }): Promise<void> };
}

/** Resolves once the server has stored the code, so the page can leave. */
export function beginLink(conn: LinkReducers, code: string): Promise<void> {
  return conn.reducers.beginLink({ code });
}

/**
 * Opens a second connection as the OIDC identity, redeems `code`, and
 * closes. Rejects when the connection fails or the server refuses.
 */
export function completeLinkWithIdToken(idToken: string, code: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    DbConnection.builder()
      .withUri(NET_CONFIG.uri)
      .withDatabaseName(NET_CONFIG.databaseName)
      .withToken(idToken)
      .onConnect((connection) => {
        connection.reducers.completeLink({ code }).then(
          () => {
            connection.disconnect();
            resolve();
          },
          (error: unknown) => {
            connection.disconnect();
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      })
      .onDisconnect((_ctx, error) => {
        // The server may refuse the token in `identity_connected`, which
        // closes the socket after the upgrade: that is a failure, not a
        // silence. A no-op once the promise has settled.
        reject(error instanceof Error ? error : new Error("link connection closed"));
      })
      .onConnectError((_ctx, error) => {
        console.error("[net] link connection failed", error);
        reject(error instanceof Error ? error : new Error(String(error)));
      })
      .build();
  });
}
