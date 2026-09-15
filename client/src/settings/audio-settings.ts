// The options menu's Audio section (Artie's direction, story 1.11): one
// master volume and one mute toggle, persisted the same way keybindings
// are -- a real control with a real, saved value, not a placeholder. No
// sound plays yet; FR153's audio story is the consumer that reads this.

import { loadVersioned, type SettingsStorage, saveVersioned } from "./settings-storage";

export interface AudioSettings {
  /** 0-100. */
  readonly masterVolume: number;
  readonly muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterVolume: 100,
  muted: false,
};

export const AUDIO_STORAGE_KEY = "bc.audio.v1";
export const AUDIO_VERSION = 1;
const PAYLOAD_KEY = "value";

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUDIO_SETTINGS.masterVolume;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merges a possibly-partial or malformed stored value over the defaults
 * -- an out-of-range volume clamps rather than propagating, and a missing
 * or wrong-typed field falls back to its own default independently. */
export function normaliseAudioSettings(raw: unknown): AudioSettings {
  if (!isRecord(raw)) return DEFAULT_AUDIO_SETTINGS;
  const masterVolume =
    typeof raw.masterVolume === "number"
      ? clampVolume(raw.masterVolume)
      : DEFAULT_AUDIO_SETTINGS.masterVolume;
  const muted = typeof raw.muted === "boolean" ? raw.muted : DEFAULT_AUDIO_SETTINGS.muted;
  return { masterVolume, muted };
}

export function loadAudioSettings(storage: SettingsStorage | null | undefined): AudioSettings {
  return loadVersioned(
    storage,
    AUDIO_STORAGE_KEY,
    AUDIO_VERSION,
    PAYLOAD_KEY,
    DEFAULT_AUDIO_SETTINGS,
    normaliseAudioSettings,
  );
}

export function saveAudioSettings(
  storage: SettingsStorage | null | undefined,
  settings: AudioSettings,
): boolean {
  return saveVersioned(storage, AUDIO_STORAGE_KEY, AUDIO_VERSION, PAYLOAD_KEY, settings);
}
