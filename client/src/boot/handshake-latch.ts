// Story 2.8 (FR147): the replay buffer between `net/connection.ts`'s own
// event callbacks (which start firing the instant `connect()` is called,
// in `main()`) and `boot-gate.ts`'s own `settled()` await (which only
// happens once `runBootGate` itself runs, after `fetchDefs`'s own await)
// -- so a handshake or an early connect failure landing in that window is
// never silently dropped.

import type { HandshakeVersion } from "./handshake";

export type HandshakeSettlement =
  | { readonly kind: "handshake"; readonly version: HandshakeVersion }
  | { readonly kind: "unreachable" };

export interface HandshakeLatch {
  /** The server's own handshake version arrived -- settles the latch
   * unless it already settled. */
  resolveHandshake(version: HandshakeVersion): void;
  /** The connection settled as unreachable *before* any handshake ever
   * arrived (a real connect error or an early drop, never "still
   * connecting") -- settles the latch unless it already settled. */
  resolveUnreachable(): void;
  /** Resolves with whichever of the two happened first -- immediately, if
   * one already had by the time this is called. Safe to call more than
   * once; every caller resolves with the same settlement. */
  settled(): Promise<HandshakeSettlement>;
}

/** Settles at most once: whichever of `resolveHandshake`/
 * `resolveUnreachable` is called first wins, and any later call is a
 * no-op. */
export function createHandshakeLatch(): HandshakeLatch {
  let settlement: HandshakeSettlement | undefined;
  let listeners: Array<(settlement: HandshakeSettlement) => void> = [];

  function settle(next: HandshakeSettlement): void {
    if (settlement) return;
    settlement = next;
    for (const listener of listeners) listener(next);
    listeners = [];
  }

  return {
    resolveHandshake: (version) => settle({ kind: "handshake", version }),
    resolveUnreachable: () => settle({ kind: "unreachable" }),
    settled: () =>
      new Promise((resolve) => {
        if (settlement) {
          resolve(settlement);
          return;
        }
        listeners.push(resolve);
      }),
  };
}
