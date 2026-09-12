// Fetches and parses the generated defs asset. FR147's own handshake (the
// server pushing its `defs_version` at connect) is a later story -- this
// only has to make the single version available to it (Quentin's
// assumption) and to never silently accept a stale deployment once a
// caller does have an expected version to compare against.

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
