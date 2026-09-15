import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  clampPercent,
  isRecord,
  loadVersioned,
  resolveStorage,
  type SettingsStorage,
  saveVersioned,
} from "../../../src/settings/settings-storage";

const KEY = "bc.test-group.v1";
const VERSION = 1;

/** A `Storage`-shaped fake that records every call, so a read that
 * secretly writes -- or a write that touches a second key -- is visible. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const reads: string[] = [];
  const writes: [string, string][] = [];
  const removals: string[] = [];
  return {
    reads,
    writes,
    removals,
    data,
    storage: {
      getItem(key: string): string | null {
        reads.push(key);
        return data.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        writes.push([key, value]);
        data.set(key, value);
      },
      removeItem(key: string): void {
        removals.push(key);
        data.delete(key);
      },
    } satisfies SettingsStorage,
  };
}

const DEFAULT = { n: 0 };
function normalise(raw: unknown): { n: number } {
  if (typeof raw === "object" && raw !== null && typeof (raw as { n?: unknown }).n === "number") {
    return { n: (raw as { n: number }).n };
  }
  return DEFAULT;
}

describe("loadVersioned / saveVersioned", () => {
  it("round-trips what saveVersioned wrote", () => {
    const fake = fakeStorage();
    saveVersioned(fake.storage, KEY, VERSION, "value", { n: 7 });
    expect(loadVersioned(fake.storage, KEY, VERSION, "value", DEFAULT, normalise)).toEqual({
      n: 7,
    });
  });

  it("uses exactly one storage key", () => {
    const fake = fakeStorage();
    saveVersioned(fake.storage, KEY, VERSION, "value", { n: 1 });
    expect(fake.writes.map(([k]) => k)).toEqual([KEY]);
    loadVersioned(fake.storage, KEY, VERSION, "value", DEFAULT, normalise);
    expect(new Set(fake.reads)).toEqual(new Set([KEY]));
  });

  it("never writes while reading", () => {
    const fake = fakeStorage({ [KEY]: "{{{ not json" });
    expect(loadVersioned(fake.storage, KEY, VERSION, "value", DEFAULT, normalise)).toEqual(DEFAULT);
    expect(fake.writes).toEqual([]);
    expect(fake.removals).toEqual([]);
  });

  it("never disturbs another key in the same origin", () => {
    const fake = fakeStorage({ "bc.other": "kept" });
    loadVersioned(fake.storage, KEY, VERSION, "value", DEFAULT, normalise);
    saveVersioned(fake.storage, KEY, VERSION, "value", { n: 1 });
    expect(fake.data.get("bc.other")).toBe("kept");
    expect(fake.removals).toEqual([]);
  });

  it("falls back to defaults with no storage at all", () => {
    expect(loadVersioned(undefined, KEY, VERSION, "value", DEFAULT, normalise)).toEqual(DEFAULT);
    expect(loadVersioned(null, KEY, VERSION, "value", DEFAULT, normalise)).toEqual(DEFAULT);
  });

  it("falls back to defaults when the key is absent", () => {
    expect(loadVersioned(fakeStorage().storage, KEY, VERSION, "value", DEFAULT, normalise)).toEqual(
      DEFAULT,
    );
  });

  it("falls back to defaults when getItem throws (private mode, blocked storage)", () => {
    const throwing: SettingsStorage = {
      getItem() {
        throw new DOMException("denied", "SecurityError");
      },
      setItem() {},
      removeItem() {},
    };
    expect(() => loadVersioned(throwing, KEY, VERSION, "value", DEFAULT, normalise)).not.toThrow();
    expect(loadVersioned(throwing, KEY, VERSION, "value", DEFAULT, normalise)).toEqual(DEFAULT);
  });

  it("falls back to defaults on corrupt JSON", () => {
    const fake = fakeStorage({ [KEY]: "]not json[" });
    expect(loadVersioned(fake.storage, KEY, VERSION, "value", DEFAULT, normalise)).toEqual(DEFAULT);
  });

  it("falls back to defaults on valid JSON of the wrong shape", () => {
    for (const stored of ["42", '"a string"', "[1, 2, 3]", "null", "{}"]) {
      const fake = fakeStorage({ [KEY]: stored });
      expect(loadVersioned(fake.storage, KEY, VERSION, "value", DEFAULT, normalise)).toEqual(
        DEFAULT,
      );
    }
  });

  it("falls back to defaults on a version it does not know", () => {
    const fake = fakeStorage({ [KEY]: JSON.stringify({ version: VERSION + 1, value: { n: 9 } }) });
    expect(loadVersioned(fake.storage, KEY, VERSION, "value", DEFAULT, normalise)).toEqual(DEFAULT);
  });

  it("a different payloadKey does not collide with another group's blob shape", () => {
    const fake = fakeStorage();
    saveVersioned(fake.storage, KEY, VERSION, "bindings", { n: 3 });
    const written = JSON.parse(fake.data.get(KEY) ?? "null");
    expect(written.bindings).toEqual({ n: 3 });
    expect(written.value).toBeUndefined();
  });

  it("reports save failure rather than throwing when storage refuses the write", () => {
    const throwing: SettingsStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem() {},
    };
    expect(() => saveVersioned(throwing, KEY, VERSION, "value", { n: 1 })).not.toThrow();
    expect(saveVersioned(throwing, KEY, VERSION, "value", { n: 1 })).toBe(false);
  });

  it("reports save failure with no storage at all, and never throws", () => {
    expect(saveVersioned(undefined, KEY, VERSION, "value", { n: 1 })).toBe(false);
    expect(saveVersioned(null, KEY, VERSION, "value", { n: 1 })).toBe(false);
  });

  it("inv_settings_read_is_total", () => {
    // Any string at all in the slot -- and any throw from storage -- is
    // usable defaults, never an exception.
    fc.assert(
      fc.property(fc.string(), (stored) => {
        const fake = fakeStorage({ [KEY]: stored });
        expect(() =>
          loadVersioned(fake.storage, KEY, VERSION, "value", DEFAULT, normalise),
        ).not.toThrow();
        expect(fake.writes).toEqual([]);
      }),
    );
  });
});

describe("resolveStorage", () => {
  it("returns the storage when it is there", () => {
    const storage = fakeStorage().storage;
    expect(resolveStorage(() => storage)).toBe(storage);
  });

  it("returns null when merely reaching for it throws", () => {
    expect(
      resolveStorage(() => {
        throw new DOMException("denied", "SecurityError");
      }),
    ).toBeNull();
  });

  it("returns null when there is no storage object at all", () => {
    expect(resolveStorage(() => undefined as unknown as SettingsStorage)).toBeNull();
  });
});

describe("isRecord", () => {
  it("is true for plain objects only, never an array, null or a primitive", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("clampPercent", () => {
  // The one clamp every percent-shaped setting group shares (Tim's
  // direction, cycle 2) -- audio's volume and display's highlight
  // strength both call this rather than each declaring their own.
  it("passes an in-range integer through unchanged", () => {
    expect(clampPercent(50, 0, 100, 0)).toBe(50);
  });

  it("clamps above the maximum and below the minimum", () => {
    expect(clampPercent(500, 0, 100, 0)).toBe(100);
    expect(clampPercent(-20, 0, 100, 0)).toBe(0);
    expect(clampPercent(0, 20, 100, 60)).toBe(20);
  });

  it("rounds a fractional value", () => {
    expect(clampPercent(50.6, 0, 100, 0)).toBe(51);
  });

  it("falls back for non-finite input (NaN, Infinity)", () => {
    expect(clampPercent(Number.NaN, 0, 100, 42)).toBe(42);
    expect(clampPercent(Number.POSITIVE_INFINITY, 0, 100, 42)).toBe(42);
  });
});
