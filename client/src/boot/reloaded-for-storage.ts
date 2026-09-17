// Story 2.8 (FR147): the guarded-reload's own storage (Tim's direction,
// section 4) -- one versioned key, read/written through
// settings/settings-storage.ts's shared idiom: reading never throws and
// never writes, and this touches no other key. `sessionStorage`, not
// `localStorage` -- the guard exists to survive *this tab's* reload,
// never to persist into a fresh visit later.

import {
  isRecord,
  loadVersioned,
  type SettingsStorage,
  saveVersioned,
} from "../settings/settings-storage";
import type { HandshakeVersion } from "./handshake";

export const RELOADED_FOR_STORAGE_KEY = "bc.handshake.reloaded-for.v1";
export const RELOADED_FOR_VERSION = 1;
const PAYLOAD_KEY = "value";

function normaliseHandshakeVersion(raw: unknown): HandshakeVersion | undefined {
  if (!isRecord(raw)) return undefined;
  const { defsVersion, protocolVersion } = raw;
  if (typeof defsVersion !== "string" || typeof protocolVersion !== "string") return undefined;
  return { defsVersion, protocolVersion };
}

/** The server version pair a previous boot this session already wrote
 * before reloading once for it -- `undefined` if none has, including
 * every reason the stored value might not be usable (no storage, a
 * throwing read, corrupt JSON, the wrong shape or a version this build
 * does not know). Never throws, never writes. */
export function readReloadedFor(storage: SettingsStorage | null): HandshakeVersion | undefined {
  return loadVersioned(
    storage,
    RELOADED_FOR_STORAGE_KEY,
    RELOADED_FOR_VERSION,
    PAYLOAD_KEY,
    undefined,
    normaliseHandshakeVersion,
  );
}

/** Records `version` as reloaded-for, before actually reloading. */
export function writeReloadedFor(storage: SettingsStorage | null, version: HandshakeVersion): void {
  saveVersioned(storage, RELOADED_FOR_STORAGE_KEY, RELOADED_FOR_VERSION, PAYLOAD_KEY, version);
}
