// The only file in this client that touches `localStorage` for FR149's
// keybindings, through an injected `Storage`-shaped interface so every
// rule below is provable without a browser.
//
// Three rules, each of which protects player data:
//   - exactly one key, [`KEYBINDINGS_STORAGE_KEY`]. Other client state
//     lives in the same origin's storage (the FR141 identity token will),
//     so this never calls `clear()` and never writes anywhere else.
//   - reading never throws. Missing, corrupt, wrong-shaped, wrong-version
//     or outright blocked storage (a `SecurityError` in private mode) all
//     fall back to the defaults *in memory*.
//   - reading never writes. The stored blob is rewritten only when the
//     player actually rebinds, so a parse bug shipped in a later build
//     cannot quietly destroy what a player set up.

import type { Bindings } from "./keybindings";
import { DEFAULT_BINDINGS, normaliseBindings } from "./keybindings";

export const KEYBINDINGS_STORAGE_KEY = "bc.keybindings.v1";

/** The stored blob's own schema version, inside the key -- so a future
 * change falls back to defaults here rather than crashing on a shape it
 * cannot read. */
export const KEYBINDINGS_VERSION = 1;

/** The slice of `Storage` this module uses. Injected, never reached for
 * globally, so `loadBindings`/`saveBindings` are testable with no jsdom
 * and no real `window`. */
export interface BindingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The storage to use, or `null` -- given a getter rather than a value
 * because reaching for `window.localStorage` can itself throw in an
 * embedded or storage-blocked context, not only reading from it. This is
 * the whole of AC4's "a browser with cleared storage falls back to
 * defaults without error" entry point, and it lives here so it is
 * testable: `main.ts` is not covered, and no browser test can make
 * property access on `localStorage` throw on demand.
 */
export function resolveStorage(
  get: () => BindingsStorage | null | undefined,
): BindingsStorage | null {
  try {
    return get() ?? null;
  } catch {
    return null;
  }
}

/** The player's bindings, or the defaults -- for every possible reason
 * the stored value might not be usable. Never throws, never writes. */
export function loadBindings(storage: BindingsStorage | null | undefined): Bindings {
  if (!storage) return DEFAULT_BINDINGS;

  let raw: string | null;
  try {
    raw = storage.getItem(KEYBINDINGS_STORAGE_KEY);
  } catch {
    // Private mode, a blocked-cookies setting, or an embedding that
    // denies storage entirely: play on defaults.
    return DEFAULT_BINDINGS;
  }
  if (raw === null) return DEFAULT_BINDINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_BINDINGS;
  }

  if (!isRecord(parsed)) return DEFAULT_BINDINGS;
  if (parsed.version !== KEYBINDINGS_VERSION) return DEFAULT_BINDINGS;
  return normaliseBindings(parsed.bindings);
}

/** Persists `bindings`, returning whether the write actually landed --
 * storage can refuse (quota, private mode) and that is not an error the
 * game should die on, or nag about. Called only from a real rebind. */
export function saveBindings(
  storage: BindingsStorage | null | undefined,
  bindings: Bindings,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({ version: KEYBINDINGS_VERSION, bindings }),
    );
    return true;
  } catch {
    return false;
  }
}
