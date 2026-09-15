// The options menu's Display section (Artie's direction, story 1.11):
// the U1 dial (`docs/ux.md` accessibility floor) -- interactable-highlight
// strength -- as a persisted 0-100 slider. The affordance overlay itself
// (`test-street/scene.ts`'s `HIGHLIGHT_ALPHA`) is not wired to this value
// in this story (no requirement asks for that plumbing yet); the value is
// saved so the affordance story that scopes doing so can read it.

import { loadVersioned, type SettingsStorage, saveVersioned } from "./settings-storage";

export interface DisplaySettings {
  /** 0-100. */
  readonly highlightStrength: number;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  highlightStrength: 100,
};

export const DISPLAY_STORAGE_KEY = "bc.display.v1";
export const DISPLAY_VERSION = 1;
const PAYLOAD_KEY = "value";

function clampStrength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DISPLAY_SETTINGS.highlightStrength;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normaliseDisplaySettings(raw: unknown): DisplaySettings {
  if (!isRecord(raw)) return DEFAULT_DISPLAY_SETTINGS;
  const highlightStrength =
    typeof raw.highlightStrength === "number"
      ? clampStrength(raw.highlightStrength)
      : DEFAULT_DISPLAY_SETTINGS.highlightStrength;
  return { highlightStrength };
}

export function loadDisplaySettings(storage: SettingsStorage | null | undefined): DisplaySettings {
  return loadVersioned(
    storage,
    DISPLAY_STORAGE_KEY,
    DISPLAY_VERSION,
    PAYLOAD_KEY,
    DEFAULT_DISPLAY_SETTINGS,
    normaliseDisplaySettings,
  );
}

export function saveDisplaySettings(
  storage: SettingsStorage | null | undefined,
  settings: DisplaySettings,
): boolean {
  return saveVersioned(storage, DISPLAY_STORAGE_KEY, DISPLAY_VERSION, PAYLOAD_KEY, settings);
}
