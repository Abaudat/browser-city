import { describe, expect, it } from "vitest";
import {
  AUDIO_STORAGE_KEY,
  AUDIO_VERSION,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  normaliseAudioSettings,
  saveAudioSettings,
} from "../../../src/settings/audio-settings";
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

describe("audio settings", () => {
  it("defaults to full volume, unmuted -- no sound plays yet, but nothing is silenced by default", () => {
    expect(DEFAULT_AUDIO_SETTINGS).toEqual({ masterVolume: 100, muted: false });
  });

  it("round-trips what saveAudioSettings wrote", () => {
    const fake = fakeStorage();
    saveAudioSettings(fake.storage, { masterVolume: 42, muted: true });
    expect(loadAudioSettings(fake.storage)).toEqual({ masterVolume: 42, muted: true });
  });

  it("falls back to defaults with no storage, corrupt JSON, or the wrong version", () => {
    expect(loadAudioSettings(undefined)).toEqual(DEFAULT_AUDIO_SETTINGS);
    const corrupt = fakeStorage({ [AUDIO_STORAGE_KEY]: "not json" });
    expect(loadAudioSettings(corrupt.storage)).toEqual(DEFAULT_AUDIO_SETTINGS);
    const wrongVersion = fakeStorage({
      [AUDIO_STORAGE_KEY]: JSON.stringify({
        version: AUDIO_VERSION + 1,
        value: { masterVolume: 1, muted: true },
      }),
    });
    expect(loadAudioSettings(wrongVersion.storage)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("clamps an out-of-range volume rather than propagating it", () => {
    expect(normaliseAudioSettings({ masterVolume: 500, muted: false })).toEqual({
      masterVolume: 100,
      muted: false,
    });
    expect(normaliseAudioSettings({ masterVolume: -20, muted: false })).toEqual({
      masterVolume: 0,
      muted: false,
    });
  });

  it("a missing or wrong-typed field falls back to its own default independently", () => {
    expect(normaliseAudioSettings({ muted: true })).toEqual({ masterVolume: 100, muted: true });
    expect(normaliseAudioSettings({ masterVolume: 30 })).toEqual({
      masterVolume: 30,
      muted: false,
    });
    expect(normaliseAudioSettings({ masterVolume: "loud", muted: "yes" })).toEqual(
      DEFAULT_AUDIO_SETTINGS,
    );
    expect(normaliseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("uses exactly one storage key", () => {
    const fake = fakeStorage();
    saveAudioSettings(fake.storage, { masterVolume: 10, muted: false });
    expect([...fake.data.keys()]).toEqual([AUDIO_STORAGE_KEY]);
  });
});
