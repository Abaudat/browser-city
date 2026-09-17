// Story 2.8 (FR147): the guarded-reload's own storage -- one versioned
// key, reading never throws and never writes, the same discipline every
// settings group in settings/settings-storage.ts shares.
import { describe, expect, it } from "vitest";
import {
  RELOADED_FOR_STORAGE_KEY,
  readReloadedFor,
  writeReloadedFor,
} from "../../../src/boot/reloaded-for-storage";

const VERSION = { defsVersion: "d1", protocolVersion: "p1" };

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    data,
  };
}

describe("readReloadedFor", () => {
  it("returns undefined when nothing was ever written", () => {
    expect(readReloadedFor(fakeStorage())).toBeUndefined();
  });

  it("returns undefined for null storage", () => {
    expect(readReloadedFor(null)).toBeUndefined();
  });

  it("returns what writeReloadedFor wrote", () => {
    const storage = fakeStorage();
    writeReloadedFor(storage, VERSION);
    expect(readReloadedFor(storage)).toEqual(VERSION);
  });

  it("falls back to undefined on corrupt JSON, never throwing", () => {
    const storage = fakeStorage({ [RELOADED_FOR_STORAGE_KEY]: "{not json" });
    expect(() => readReloadedFor(storage)).not.toThrow();
    expect(readReloadedFor(storage)).toBeUndefined();
  });

  it("falls back to undefined on a wrong-shaped payload", () => {
    const storage = fakeStorage({
      [RELOADED_FOR_STORAGE_KEY]: JSON.stringify({ version: 1, value: { defsVersion: 1 } }),
    });
    expect(readReloadedFor(storage)).toBeUndefined();
  });

  it("falls back to undefined when the payload is not even a record", () => {
    const storage = fakeStorage({
      [RELOADED_FOR_STORAGE_KEY]: JSON.stringify({ version: 1, value: "not-a-record" }),
    });
    expect(readReloadedFor(storage)).toBeUndefined();
  });

  it("falls back to undefined on a wrong version", () => {
    const storage = fakeStorage({
      [RELOADED_FOR_STORAGE_KEY]: JSON.stringify({ version: 99, value: VERSION }),
    });
    expect(readReloadedFor(storage)).toBeUndefined();
  });

  it("writes only the one key", () => {
    const storage = fakeStorage();
    writeReloadedFor(storage, VERSION);
    expect([...storage.data.keys()]).toEqual([RELOADED_FOR_STORAGE_KEY]);
  });

  it("reading never writes", () => {
    const storage = fakeStorage();
    readReloadedFor(storage);
    expect(storage.data.size).toBe(0);
  });
});

describe("writeReloadedFor", () => {
  it("returns true when the write actually lands", () => {
    expect(writeReloadedFor(fakeStorage(), VERSION)).toBe(true);
  });

  it("returns false for null storage, never throwing", () => {
    expect(() => writeReloadedFor(null, VERSION)).not.toThrow();
    expect(writeReloadedFor(null, VERSION)).toBe(false);
  });

  it("returns false when setItem throws, never throwing itself", () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("quota exceeded");
    };
    expect(() => writeReloadedFor(storage, VERSION)).not.toThrow();
    expect(writeReloadedFor(storage, VERSION)).toBe(false);
  });
});
