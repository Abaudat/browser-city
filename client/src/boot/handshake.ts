// Story 2.8 (FR147): the whole decision is one pure function -- no
// `window`, no `fetch`, no storage in this module; every effect (the
// refetch, the reload, reading/writing `sessionStorage`) is injected by
// `boot-gate.ts`/`main.ts` (Quentin's direction). `boot-gate.ts` is the
// only caller.

import type { Defs } from "../defs/types";

/** The FR147 handshake's own row shape -- `defs_version` and
 * `protocol_version`, nothing folded together (`docs/architecture.md`).
 * Carried by both the server's `module_version` view row and the client's
 * own compiled-in `net/protocol-version.ts` constant plus its
 * currently-fetched `Defs.defsVersion`. */
export interface HandshakeVersion {
  readonly defsVersion: string;
  readonly protocolVersion: string;
}

export type HandshakeVerdict = "proceed" | "refetch-defs" | "reload" | "updating";

function sameVersion(a: HandshakeVersion, b: HandshakeVersion): boolean {
  return a.defsVersion === b.defsVersion && a.protocolVersion === b.protocolVersion;
}

/**
 * `reloadedFor`, when given, is the server version pair a *previous* boot
 * this session already wrote to storage before reloading once for it
 * (Tim's direction, section 4) -- `undefined` means no guarded reload has
 * happened yet this session.
 *
 * - Both fields equal -> `proceed`.
 * - `protocolVersion` differs -> `decideReload` (the bindings compiled
 *   into this bundle cannot refresh themselves; nothing but a reload can).
 * - Only `defsVersion` differs -> `refetch-defs`.
 *
 * A missing, empty or malformed `server` version never differs from a
 * real client version by accident into reading as a match -- strict
 * string equality against a real, non-empty client value already refuses
 * that, with no special-casing needed.
 */
export function decideHandshake(
  server: HandshakeVersion,
  client: HandshakeVersion,
  reloadedFor: HandshakeVersion | undefined,
): HandshakeVerdict {
  if (sameVersion(server, client)) return "proceed";
  if (server.protocolVersion !== client.protocolVersion) {
    return decideReload(server, reloadedFor);
  }
  return "refetch-defs";
}

/**
 * The guarded-reload decision (Tim's direction, section 4): a `reload` is
 * allowed once per server version -- a server version already reloaded
 * for this session answers `updating` instead, so the client never
 * reload-loops against its own host across a deploy. Exported so
 * `boot-gate.ts` can re-run it after a `refetch-defs` attempt throws
 * (still stale, or unparsable) without duplicating the guard.
 */
export function decideReload(
  server: HandshakeVersion,
  reloadedFor: HandshakeVersion | undefined,
): "reload" | "updating" {
  return reloadedFor !== undefined && sameVersion(reloadedFor, server) ? "updating" : "reload";
}

/** A `Defs` the FR147 handshake has actually verified against the
 * server's own version -- or, structurally identically, one the boot gate
 * decided to mount anyway because the connection never resolved an
 * answer at all (Tim's direction: "unknown" is not "known stale"). The
 * branded field is not exported, so no module outside this one can
 * produce a `VerifiedDefs` by simply asserting a plain `Defs` into the
 * type -- `markVerified` is the one, explicit escape hatch. */
declare const VERIFIED: unique symbol;
export type VerifiedDefs = Defs & { readonly [VERIFIED]: true };

export function markVerified(defs: Defs): VerifiedDefs {
  return defs as VerifiedDefs;
}
