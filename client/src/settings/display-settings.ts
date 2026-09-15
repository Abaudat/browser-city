// The options menu's Display section (Artie's direction, story 1.11):
// the U1 dial (`docs/ux.md` accessibility floor) -- object-highlight
// strength -- as a persisted slider, wired live into
// `test-street/scene.ts`'s affordance overlay (`highlightOverlayAlpha`).
//
// The range is [20, 100], not [0, 100], and the default is 60, not 100
// (Artie's direction, cycle 2): zero would mean no affordance at all,
// and `docs/ux.md` §1 makes the hover highlight how a player learns an
// object is out of reach -- letting the dial reach zero reopens the
// "can't find the game" failure the affordance exists to prevent. The
// floor and default are load-bearing the moment this ships: the value is
// saved, and a later change to the default never reaches a player who
// already saved one.

import {
  clampPercent,
  isRecord,
  loadVersioned,
  type SettingsStorage,
  saveVersioned,
} from "./settings-storage";

export interface DisplaySettings {
  /** 20-100. */
  readonly highlightStrength: number;
}

export const HIGHLIGHT_STRENGTH_MIN = 20;
export const HIGHLIGHT_STRENGTH_MAX = 100;

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  highlightStrength: 60,
};

export const DISPLAY_STORAGE_KEY = "bc.display.v1";
export const DISPLAY_VERSION = 1;
const PAYLOAD_KEY = "value";

export function normaliseDisplaySettings(raw: unknown): DisplaySettings {
  if (!isRecord(raw)) return DEFAULT_DISPLAY_SETTINGS;
  const highlightStrength =
    typeof raw.highlightStrength === "number"
      ? clampPercent(
          raw.highlightStrength,
          HIGHLIGHT_STRENGTH_MIN,
          HIGHLIGHT_STRENGTH_MAX,
          DEFAULT_DISPLAY_SETTINGS.highlightStrength,
        )
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
