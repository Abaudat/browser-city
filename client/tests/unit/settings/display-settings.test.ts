import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_STORAGE_KEY,
  DISPLAY_VERSION,
  loadDisplaySettings,
  normaliseDisplaySettings,
  saveDisplaySettings,
} from "../../../src/settings/display-settings";
import type { SettingsStorage } from "../../../src/settings/settings-storage";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    } satisfies SettingsStorage,
  };
}

describe("display settings", () => {
  it("defaults to full highlight strength", () => {
    expect(DEFAULT_DISPLAY_SETTINGS).toEqual({ highlightStrength: 100 });
  });

  it("round-trips what saveDisplaySettings wrote", () => {
    const fake = fakeStorage();
    saveDisplaySettings(fake.storage, { highlightStrength: 60 });
    expect(loadDisplaySettings(fake.storage)).toEqual({ highlightStrength: 60 });
  });

  it("falls back to defaults with no storage, corrupt JSON, or the wrong version", () => {
    expect(loadDisplaySettings(undefined)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    const corrupt = fakeStorage({ [DISPLAY_STORAGE_KEY]: "not json" });
    expect(loadDisplaySettings(corrupt.storage)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    const wrongVersion = fakeStorage({
      [DISPLAY_STORAGE_KEY]: JSON.stringify({
        version: DISPLAY_VERSION + 1,
        value: { highlightStrength: 1 },
      }),
    });
    expect(loadDisplaySettings(wrongVersion.storage)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("clamps an out-of-range strength rather than propagating it", () => {
    expect(normaliseDisplaySettings({ highlightStrength: 500 })).toEqual({
      highlightStrength: 100,
    });
    expect(normaliseDisplaySettings({ highlightStrength: -20 })).toEqual({
      highlightStrength: 0,
    });
  });

  it("a wrong-typed field falls back to the default", () => {
    expect(normaliseDisplaySettings({ highlightStrength: "bright" })).toEqual(
      DEFAULT_DISPLAY_SETTINGS,
    );
    expect(normaliseDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("uses exactly one storage key", () => {
    const fake = fakeStorage();
    saveDisplaySettings(fake.storage, { highlightStrength: 10 });
    expect([...fake.data.keys()]).toEqual([DISPLAY_STORAGE_KEY]);
  });
});
