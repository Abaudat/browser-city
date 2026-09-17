// Story 2.8 (FR147): the boot gate -- connect, get the version, maybe
// refresh, then start rendering -- kept in its own module with the
// network, fetch and renderer all passed in (Quentin's direction), so it
// is unit-tested with fakes rather than a real socket or a real fetch.
// "Never draws a stale frame" is structural here, not a convention: this
// is the one function that can produce a `VerifiedDefs`
// (`handshake.ts`'s `markVerified`), and `main.ts` never calls
// `mountStreetScene` without going through it.
//
// Cycle 1 review changes: a handshake timeout (Quentin's finding 2) so a
// hung socket cannot block the gate forever; a single refetch attempt,
// never a loop (Tim's finding 4 -- the identical cache-busted URL is
// answered by the browser's own HTTP cache on a second attempt, so a
// retry buys nothing); a failed first fetch does not bypass the
// handshake (Tim's finding 5); a guarded-reload attempt that can fail
// (storage blocked, `reload()` itself throwing) degrades instead of
// falling through unguarded (Tim's blocker finding), via the same
// `guarded-reload.ts` helper `post-mount-guard.ts` shares.

import { DefsVersionMismatchError } from "../defs/load";
import type { Defs } from "../defs/types";
import { attemptGuardedReload, type GuardedReloadDeps } from "./guarded-reload";
import {
  decideHandshake,
  decideReload,
  type HandshakeVersion,
  markVerified,
  type VerifiedDefs,
} from "./handshake";
import type { HandshakeLatch, HandshakeSettlement } from "./handshake-latch";

/** How long the gate waits for the handshake to settle at all before
 * treating the connection as unreachable -- a WebSocket stuck in
 * `connecting` (a black-holing proxy, a captive portal, a server
 * accepting TCP but never upgrading) otherwise never produces a
 * `HandshakeSettlement`, and the gate would wait forever (Quentin's
 * finding 2). Generous relative to NFR1's one-second budget -- this is a
 * last-resort fallback for a genuinely stuck connection, not the common
 * path -- and short enough that a player is never left looking at a
 * blank canvas indefinitely. */
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 8_000;

/** A client `defsVersion` that can never equal a real one (always 16 hex
 * characters) -- the first `fetchDefs` failing means "unknown", not
 * "empty string happens to be this build's version" (Tim's finding 5). */
const UNKNOWN_DEFS_VERSION = "";

export interface BootGateDeps {
  /** `defs/load.ts`'s own `fetchDefs` signature exactly. */
  fetchDefs(path: string, expectedVersion?: string): Promise<Defs>;
  readonly defsPath: string;
  /** The client's own compiled-in protocol version
   * (`net/protocol-version.ts`'s `PROTOCOL_VERSION`) -- injected, never
   * imported directly, so this module stays free of a generated-artefact
   * import. */
  readonly clientProtocolVersion: string;
  /** Settles with the server's own handshake version, or `unreachable` if
   * the connection never resolved one at all (`net/connection.ts`'s own
   * callbacks, bridged through a `HandshakeLatch` in `main.ts`). */
  readonly handshake: Pick<HandshakeLatch, "settled">;
  /** The server version pair a previous boot this session already wrote
   * before reloading once for it -- `undefined` if none has. */
  readReloadedFor(): HandshakeVersion | undefined;
  /** Returns whether the write actually landed
   * (`reloaded-for-storage.ts`'s own signature). */
  writeReloadedFor(version: HandshakeVersion): boolean;
  /** Reloads the page. Never called more than once per boot gate run. */
  reload(): void;
  /** Called instead of resolving when the gate gives up rendering this
   * session (NFR42) -- the `updating` connection-notice status. */
  onDegrade(): void;
  /** Overridable only by tests; production always uses the default. */
  readonly handshakeTimeoutMs?: number;
}

export interface BootGateResult {
  readonly defs: VerifiedDefs;
}

function settleWithTimeout(deps: BootGateDeps): Promise<HandshakeSettlement> {
  const timeoutMs = deps.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "unreachable" });
    }, timeoutMs);
    deps.handshake.settled().then((settlement) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(settlement);
    });
  });
}

function resolveReloadOrDegrade(
  deps: GuardedReloadDeps,
  server: HandshakeVersion,
  verdict: "reload" | "updating",
): void {
  if (verdict === "updating") {
    deps.onDegrade();
    return;
  }
  attemptGuardedReload(deps, server);
}

/**
 * Resolves with the defs to mount, or `undefined` when the gate itself
 * has already handled the outcome (a reload was triggered, or the
 * connection-notice was degraded to `updating`) -- in either case there
 * is nothing left for the caller to render this session.
 *
 * Rejects only when the first, unversioned `fetchDefs` throws *and* the
 * connection is also unreachable -- there is nothing to mount and
 * nothing to compare against, so `main.ts`'s own NFR42 catch is what
 * handles it, exactly as it did before this story.
 */
export async function runBootGate(deps: BootGateDeps): Promise<BootGateResult | undefined> {
  let localDefs: Defs | undefined;
  let firstFetchError: unknown;
  try {
    localDefs = await deps.fetchDefs(deps.defsPath);
  } catch (error) {
    firstFetchError = error;
  }

  const settlement = await settleWithTimeout(deps);

  if (settlement.kind === "unreachable") {
    // Tim's direction: an unreachable server is "unknown", never "known
    // stale" -- there are no server rows to misread without a
    // connection, so the fetched defs (if the first fetch succeeded at
    // all) are mounted as-is.
    if (localDefs) return { defs: markVerified(localDefs) };
    throw firstFetchError;
  }

  const server = settlement.version;
  const client: HandshakeVersion = {
    defsVersion: localDefs?.defsVersion ?? UNKNOWN_DEFS_VERSION,
    protocolVersion: deps.clientProtocolVersion,
  };

  const verdict = decideHandshake(server, client, deps.readReloadedFor());

  if (verdict === "proceed" && localDefs) {
    return { defs: markVerified(localDefs) };
  }

  if (verdict === "proceed" || verdict === "refetch-defs") {
    // Either the versions genuinely differ, or the first fetch failed
    // (client.defsVersion was UNKNOWN_DEFS_VERSION) -- either way there
    // is no usable local defs to mount, so this always (re)fetches
    // cache-busted with the server's own version. One attempt only: the
    // identical URL would only ever be answered by the browser's own
    // HTTP cache on a second attempt (Tim's finding 4).
    try {
      const refetched = await deps.fetchDefs(deps.defsPath, server.defsVersion);
      return { defs: markVerified(refetched) };
    } catch (error) {
      if (error instanceof DefsVersionMismatchError) {
        deps.onDegrade();
        return undefined;
      }
      resolveReloadOrDegrade(deps, server, decideReload(server, deps.readReloadedFor()));
      return undefined;
    }
  }

  // "reload" | "updating"
  resolveReloadOrDegrade(deps, server, verdict);
  return undefined;
}
