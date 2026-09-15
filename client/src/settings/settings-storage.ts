// The one storage idiom every settings group in this client shares
// (Tim's direction, story 1.11): a versioned blob in exactly one
// `localStorage` key per group, read once at boot through an injected
// `Storage`-shaped interface. `input/keybindings-storage.ts` was the
// first and only copy of this; this module is that copy, generalised, so
// a second settings group (audio, display, ...) never grows its own.
//
// The same three rules as before, for every group that uses this:
//   - exactly one key per group. This never calls `clear()` and never
//     touches a key it was not given.
//   - reading never throws. Missing, corrupt, wrong-shaped, wrong-version
//     or outright blocked storage (a `SecurityError` in private mode) all
//     fall back to the caller's own defaults *in memory*.
//   - reading never writes. The stored blob is rewritten only when the
//     caller actually calls `saveVersioned`.

/** The slice of `Storage` this module uses. Injected, never reached for
 * globally, so every caller stays testable with no jsdom and no real
 * `window`. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Exported so every settings group's own `normalise*` function shares
 * one shape check rather than each declaring its own copy (Tim's
 * direction, cycle 2). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clamps a percent-shaped setting (volume, highlight strength, ...) into
 * `[min, max]`, rounding to an integer -- the one clamp every such
 * setting group shares, rather than each declaring `clampVolume`/
 * `clampStrength` as the same function under a different name (Tim's
 * direction, cycle 2). Non-finite input (`NaN`, `Infinity`, a value that
 * was never actually a number) falls back to `fallback`. */
export function clampPercent(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** The storage to use, or `null` -- given a getter rather than a value
 * because reaching for `window.localStorage` can itself throw in an
 * embedded or storage-blocked context, not only reading from it. */
export function resolveStorage(
  get: () => SettingsStorage | null | undefined,
): SettingsStorage | null {
  try {
    return get() ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads one versioned settings blob, `{ version, [payloadKey]: ... }`,
 * and normalises its payload -- or returns `fallback` for every possible
 * reason the stored value might not be usable (no storage, a throwing
 * read, corrupt JSON, the wrong shape, or a version this build does not
 * know). Never throws, never writes.
 *
 * `payloadKey` is the property the payload sits under inside the blob --
 * kept as a parameter, not a fixed `"value"`, so an existing group (like
 * keybindings' own `bindings`) can move onto this shared mechanism
 * without changing the JSON it already has on disk.
 */
export function loadVersioned<T>(
  storage: SettingsStorage | null | undefined,
  key: string,
  version: number,
  payloadKey: string,
  fallback: T,
  normalise: (raw: unknown) => T,
): T {
  if (!storage) return fallback;

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    // Private mode, a blocked-cookies setting, or an embedding that
    // denies storage entirely: play on defaults.
    return fallback;
  }
  if (raw === null) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (!isRecord(parsed)) return fallback;
  if (parsed.version !== version) return fallback;
  return normalise(parsed[payloadKey]);
}

/** Persists one versioned settings blob, returning whether the write
 * actually landed -- storage can refuse (quota, private mode) and that is
 * not an error the game should die on, or nag about. */
export function saveVersioned<T>(
  storage: SettingsStorage | null | undefined,
  key: string,
  version: number,
  payloadKey: string,
  value: T,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ version, [payloadKey]: value }));
    return true;
  } catch {
    return false;
  }
}
