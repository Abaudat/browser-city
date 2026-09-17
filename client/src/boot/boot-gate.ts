// Story 2.8 (FR147): the boot gate -- connect, get the version, maybe
// refresh, then start rendering -- kept in its own module with the
// network, fetch and renderer all passed in (Quentin's direction), so it
// is unit-tested with fakes rather than a real socket or a real fetch.
// "Never draws a stale frame" is structural here, not a convention: this
// is the one function that can produce a `VerifiedDefs`
// (`handshake.ts`'s `markVerified`), and `main.ts` never calls
// `mountStreetScene` without going through it.

import { DefsVersionMismatchError } from "../defs/load";
import type { Defs } from "../defs/types";
import {
  decideHandshake,
  decideReload,
  type HandshakeVersion,
  markVerified,
  type VerifiedDefs,
} from "./handshake";
import type { HandshakeLatch } from "./handshake-latch";

/** Bounded retry for a `defs_version` still stale right after a refetch
 * (CDN/Pages propagation lag right after a deploy) -- never infinite
 * (NFR42): "the client must not refetch or reload forever" (Quentin's
 * direction). */
const DEFAULT_MAX_REFETCH_ATTEMPTS = 3;

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
  /** Records `version` as reloaded-for, before actually reloading. */
  writeReloadedFor(version: HandshakeVersion): void;
  /** Reloads the page. Never called more than once per boot gate run. */
  reload(): void;
  /** Called instead of resolving when the gate gives up rendering this
   * session (NFR42) -- the `updating` connection-notice status. */
  onDegrade(): void;
  /** Overridable only by tests; production always uses the default. */
  readonly maxRefetchAttempts?: number;
}

export interface BootGateResult {
  readonly defs: VerifiedDefs;
}

/**
 * Resolves with the defs to mount, or `undefined` when the gate itself
 * has already handled the outcome (a reload was triggered, or the
 * connection-notice was degraded to `updating`) -- in either case there
 * is nothing left for the caller to render this session.
 */
export async function runBootGate(deps: BootGateDeps): Promise<BootGateResult | undefined> {
  const localDefs = await deps.fetchDefs(deps.defsPath);

  const settlement = await deps.handshake.settled();
  if (settlement.kind === "unreachable") {
    // Tim's direction: an unreachable server is "unknown", never "known
    // stale" -- there are no server rows to misread without a
    // connection, so the fetched defs are mounted as-is.
    return { defs: markVerified(localDefs) };
  }

  const server = settlement.version;
  const client: HandshakeVersion = {
    defsVersion: localDefs.defsVersion,
    protocolVersion: deps.clientProtocolVersion,
  };
  const maxAttempts = deps.maxRefetchAttempts ?? DEFAULT_MAX_REFETCH_ATTEMPTS;

  let verdict = decideHandshake(server, client, deps.readReloadedFor());

  if (verdict === "refetch-defs") {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const refetched = await deps.fetchDefs(deps.defsPath, server.defsVersion);
        return { defs: markVerified(refetched) };
      } catch (error) {
        if (error instanceof DefsVersionMismatchError) {
          if (attempt >= maxAttempts) {
            deps.onDegrade();
            return undefined;
          }
          continue;
        }
        // Not a version mismatch (a network failure, or the old bundle
        // could not parse the new document's shape) -- the same
        // escalation a protocol mismatch gets (Tim's direction).
        verdict = decideReload(server, deps.readReloadedFor());
        break;
      }
    }
  }

  if (verdict === "reload") {
    deps.writeReloadedFor(server);
    deps.reload();
    return undefined;
  }
  if (verdict === "updating") {
    deps.onDegrade();
    return undefined;
  }

  // "proceed": the already-fetched local defs matched the server all
  // along.
  return { defs: markVerified(localDefs) };
}
