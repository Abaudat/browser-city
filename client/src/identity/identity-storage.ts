// The one place the device's identity token is stored (story 4.5, FR141):
// a versioned blob in exactly one `localStorage` key, on the
// `settings/settings-storage.ts` idiom with three stricter rules, because
// this key is the player's life in a world with no wipes:
//   - it is written only when the key is empty -- never overwritten, never
//     cleared, whatever the stored value looks like (a corrupt value is
//     kept byte for byte);
//   - a write is read back, and the caller is told whether it landed;
//   - nothing here logs: the token is a credential.

import { loadVersioned, type SettingsStorage, saveVersioned } from "../settings/settings-storage";

export const IDENTITY_STORAGE_KEY = "bc.identity.v1";
const VERSION = 1;
const PAYLOAD = "token";

/** What `rememberFirstToken` did. */
export type RememberOutcome =
  /** Written, and read back. */
  | { readonly kind: "stored" }
  /** The key already held something (a second tab raced this one, or the
   * value is corrupt): nothing was written. `token` is the usable stored
   * token, or `null` for a value this build cannot read. */
  | { readonly kind: "occupied"; readonly token: string | null }
  /** The write threw or did not read back: the identity is not persisted. */
  | { readonly kind: "unwritable" };

function normalise(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** The stored token, or `null`. Never throws, never writes. */
export function readStoredToken(storage: SettingsStorage | null | undefined): string | null {
  return loadVersioned(storage, IDENTITY_STORAGE_KEY, VERSION, PAYLOAD, null, normalise);
}

function keyIsEmpty(storage: SettingsStorage): boolean | null {
  try {
    return storage.getItem(IDENTITY_STORAGE_KEY) === null;
  } catch {
    return null;
  }
}

/** Stores `token` only if the key is empty. */
export function rememberFirstToken(
  storage: SettingsStorage | null | undefined,
  token: string,
): RememberOutcome {
  if (!storage) return { kind: "unwritable" };
  const empty = keyIsEmpty(storage);
  if (empty === null) return { kind: "unwritable" };
  if (!empty) return { kind: "occupied", token: readStoredToken(storage) };
  if (!saveVersioned(storage, IDENTITY_STORAGE_KEY, VERSION, PAYLOAD, token)) {
    return { kind: "unwritable" };
  }
  return readStoredToken(storage) === token ? { kind: "stored" } : { kind: "unwritable" };
}
