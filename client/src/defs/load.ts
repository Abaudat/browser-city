// Fetches and parses the generated defs asset. `boot/boot-gate.ts` is
// FR147's own caller (story 2.8): the boot gate's first, unversioned
// fetch is what "the client's own defs_version" means before any
// comparison happens, and a `refetch-defs` verdict calls this again with
// the server's own `defs_version` as `expectedVersion` -- never silently
// accepting a stale deployment once a caller does have one to compare
// against.

import { parseDefs } from "./parse";
import type { Defs } from "./types";

export class DefsVersionMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`defs_version mismatch: expected '${expected}', got '${actual}' -- a stale deployment`);
    this.name = "DefsVersionMismatchError";
  }
}

/**
 * Fetches `path` (cache-busted by `expectedVersion` when given, so a
 * stale CDN/browser cache is never served across a version bump) and
 * parses it. When `expectedVersion` is given and does not match the
 * fetched document's own `defs_version`, throws
 * [`DefsVersionMismatchError`] rather than silently accepting a stale
 * deployment (Tim's direction) -- never accepted, and never logged-and-
 * ignored either.
 *
 * `expectedVersion` stays optional only because `boot/boot-gate.ts`'s
 * very first call has no server version to compare against yet -- every
 * other call (a `refetch-defs` verdict) passes the server's own
 * `defs_version`; no caller may omit it once one exists to compare
 * against.
 */
export async function fetchDefs(path: string, expectedVersion?: string): Promise<Defs> {
  const url = expectedVersion ? `${path}?v=${encodeURIComponent(expectedVersion)}` : path;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetchDefs: ${url} responded ${response.status}`);
  }
  const data: unknown = await response.json();
  const defs = parseDefs(data);
  if (expectedVersion !== undefined && defs.defsVersion !== expectedVersion) {
    throw new DefsVersionMismatchError(expectedVersion, defs.defsVersion);
  }
  return defs;
}
