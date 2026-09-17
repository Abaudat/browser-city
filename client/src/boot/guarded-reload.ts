// Story 2.8 (FR147), cycle 1 review (Tim's blocker finding): the one
// place both `boot-gate.ts` and `post-mount-guard.ts` attempt a guarded
// reload -- a storage write that did not land, or a throwing `reload()`
// itself, must always fall back to `onDegrade()`, never an unguarded
// reload (a reload storm against the client's own host for the whole
// publish-to-Pages propagation window of every deploy).

import type { HandshakeVersion } from "./handshake";

export interface GuardedReloadDeps {
  /** Returns whether the write actually landed
   * (`reloaded-for-storage.ts`'s own `writeReloadedFor` signature). */
  writeReloadedFor(version: HandshakeVersion): boolean;
  reload(): void;
  onDegrade(): void;
}

/**
 * Records `server` as reloaded-for, then reloads -- unless either step
 * fails, in which case this degrades instead. Never throws.
 */
export function attemptGuardedReload(deps: GuardedReloadDeps, server: HandshakeVersion): void {
  const wrote = deps.writeReloadedFor(server);
  if (!wrote) {
    deps.onDegrade();
    return;
  }
  try {
    deps.reload();
  } catch {
    deps.onDegrade();
  }
}
