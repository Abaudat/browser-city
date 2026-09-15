// The FR149 keybindings group's own use of the shared settings-storage
// idiom (`../settings/settings-storage.ts`, Tim's direction story 1.11):
// exactly one key, [`KEYBINDINGS_STORAGE_KEY`], read once through an
// injected `Storage`-shaped interface. Reading never throws and never
// writes -- the mechanism that guarantees both now lives in
// `settings-storage.ts`, shared with every other settings group
// (`settings/audio-settings.ts`, `settings/display-settings.ts`), so this
// file is only the shape and defaults this one group carries.

import {
  loadVersioned,
  resolveStorage as resolveSettingsStorage,
  type SettingsStorage,
  saveVersioned,
} from "../settings/settings-storage";
import type { Bindings } from "./keybindings";
import { DEFAULT_BINDINGS, normaliseBindings } from "./keybindings";

export const KEYBINDINGS_STORAGE_KEY = "bc.keybindings.v1";

/** The stored blob's own schema version, inside the key -- so a future
 * change falls back to defaults here rather than crashing on a shape it
 * cannot read. */
export const KEYBINDINGS_VERSION = 1;

/** The payload sits under `bindings` inside the stored blob -- the shape
 * this key already had before the storage mechanism was generalised, and
 * never renamed for it. */
const PAYLOAD_KEY = "bindings";

/** The slice of `Storage` this module uses. Injected, never reached for
 * globally, so `loadBindings`/`saveBindings` are testable with no jsdom
 * and no real `window`. */
export type BindingsStorage = SettingsStorage;

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
  return resolveSettingsStorage(get);
}

/** The player's bindings, or the defaults -- for every possible reason
 * the stored value might not be usable. Never throws, never writes. */
export function loadBindings(storage: BindingsStorage | null | undefined): Bindings {
  return loadVersioned(
    storage,
    KEYBINDINGS_STORAGE_KEY,
    KEYBINDINGS_VERSION,
    PAYLOAD_KEY,
    DEFAULT_BINDINGS,
    normaliseBindings,
  );
}

/** Persists `bindings`, returning whether the write actually landed --
 * storage can refuse (quota, private mode) and that is not an error the
 * game should die on, or nag about. Called only from a real rebind. */
export function saveBindings(
  storage: BindingsStorage | null | undefined,
  bindings: Bindings,
): boolean {
  return saveVersioned(
    storage,
    KEYBINDINGS_STORAGE_KEY,
    KEYBINDINGS_VERSION,
    PAYLOAD_KEY,
    bindings,
  );
}
