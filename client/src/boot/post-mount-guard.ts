// Story 2.8 (FR147), cycle 1 review (Quentin finding 1 / Tim finding 3):
// the handshake does not stop being live once the scene mounts -- a tab
// left open across a deploy must not keep silently drawing a definition
// set (or a protocol) it now knows is stale, and `check-view-live-
// refresh.sh` proves the server side of exactly this (a live client
// observes a republish). `main.ts` wires this to every later handshake
// version `net/connection.ts` reports -- including one that arrives after
// the boot gate mounted with "unreachable" defs, which this guard treats
// no differently: the reference version is whatever actually rendered,
// regardless of which `boot-gate.ts` path produced it.
//
// No live defs swap and no scene remount post-mount (Tim's direction): a
// defs-only mismatch is escalated to the same guarded-reload decision a
// protocol mismatch already takes, after the world has stopped drawing.

import { attemptGuardedReload, type GuardedReloadDeps } from "./guarded-reload";
import { decideHandshake, decideReload, type HandshakeVersion } from "./handshake";

export interface PostMountGuardDeps extends GuardedReloadDeps {
  /** The version pair actually rendering right now -- the mounted defs'
   * own `defsVersion` plus the compiled-in `protocolVersion`. */
  readonly referenceVersion: HandshakeVersion;
  readReloadedFor(): HandshakeVersion | undefined;
  /** Stops the world from drawing anything further. Called before a
   * reload or a degrade, never after -- "never draws a frame using a
   * definition set it knows to be stale" applies here too, not only at
   * boot. */
  stopDrawing(): void;
}

export interface PostMountGuard {
  /** Feed every later handshake version `net/connection.ts` reports --
   * wired for the whole rest of the session, not just the first
   * arrival. Returns whether this call acted (stopped drawing and took
   * the reload/updating path) -- `false` for a matching re-insert, and
   * always `false` once the guard has already acted once
   * (`boot-sequence.ts` uses the return value for its own catch-up
   * replay, cycle 2 review). */
  onHandshake(server: HandshakeVersion): boolean;
}

/** Acts on at most one mismatch: once this guard has stopped drawing and
 * reloaded (or degraded), a reload is already under way and a degrade is
 * already terminal, so there is nothing left to compare against. */
export function createPostMountGuard(deps: PostMountGuardDeps): PostMountGuard {
  let acted = false;
  return {
    onHandshake(server) {
      if (acted) return false;
      const verdict = decideHandshake(server, deps.referenceVersion, deps.readReloadedFor());
      if (verdict === "proceed") return false;

      acted = true;
      deps.stopDrawing();

      const reloadVerdict =
        verdict === "refetch-defs" ? decideReload(server, deps.readReloadedFor()) : verdict;
      if (reloadVerdict === "updating") {
        deps.onDegrade();
        return true;
      }
      attemptGuardedReload(deps, server);
      return true;
    },
  };
}
