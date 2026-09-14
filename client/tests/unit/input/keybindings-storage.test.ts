import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, rebind } from "../../../src/input/keybindings";
import type { BindingsStorage } from "../../../src/input/keybindings-storage";
import {
  KEYBINDINGS_STORAGE_KEY,
  KEYBINDINGS_VERSION,
  loadBindings,
  saveBindings,
} from "../../../src/input/keybindings-storage";

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
    } satisfies BindingsStorage,
  };
}

function blobFor(bindings: Record<string, readonly string[]>, version = KEYBINDINGS_VERSION) {
  return JSON.stringify({ version, bindings });
}

describe("loadBindings", () => {
  it("round-trips what saveBindings wrote", () => {
    const fake = fakeStorage();
    const rebound = rebind(DEFAULT_BINDINGS, "move_up", 0, "KeyI");
    saveBindings(fake.storage, rebound);
    expect(loadBindings(fake.storage)).toEqual(rebound);
  });

  it("uses exactly one storage key", () => {
    const fake = fakeStorage();
    saveBindings(fake.storage, DEFAULT_BINDINGS);
    expect(fake.writes.map(([key]) => key)).toEqual([KEYBINDINGS_STORAGE_KEY]);
    loadBindings(fake.storage);
    expect(new Set(fake.reads)).toEqual(new Set([KEYBINDINGS_STORAGE_KEY]));
  });

  it("never writes while reading, so a parse bug can never destroy saved bindings", () => {
    const fake = fakeStorage({ [KEYBINDINGS_STORAGE_KEY]: "{{{ not json" });
    expect(loadBindings(fake.storage)).toEqual(DEFAULT_BINDINGS);
    expect(fake.writes).toEqual([]);
    expect(fake.removals).toEqual([]);
  });

  it("never disturbs another origin key, such as the identity token", () => {
    const fake = fakeStorage({ "bc.identity": "token-value" });
    loadBindings(fake.storage);
    saveBindings(fake.storage, rebind(DEFAULT_BINDINGS, "move_up", 0, "KeyI"));
    expect(fake.data.get("bc.identity")).toBe("token-value");
    expect(fake.removals).toEqual([]);
  });

  it("falls back to defaults with no storage at all", () => {
    expect(loadBindings(undefined)).toEqual(DEFAULT_BINDINGS);
    expect(loadBindings(null)).toEqual(DEFAULT_BINDINGS);
  });

  it("falls back to defaults when the key is absent", () => {
    expect(loadBindings(fakeStorage().storage)).toEqual(DEFAULT_BINDINGS);
  });

  it("falls back to defaults when getItem itself throws (private mode, blocked storage)", () => {
    const throwing: BindingsStorage = {
      getItem() {
        throw new DOMException("denied", "SecurityError");
      },
      setItem() {},
      removeItem() {},
    };
    expect(() => loadBindings(throwing)).not.toThrow();
    expect(loadBindings(throwing)).toEqual(DEFAULT_BINDINGS);
  });

  it("falls back to defaults on corrupt JSON", () => {
    const fake = fakeStorage({ [KEYBINDINGS_STORAGE_KEY]: "]not json[" });
    expect(loadBindings(fake.storage)).toEqual(DEFAULT_BINDINGS);
  });

  it("falls back to defaults on valid JSON of the wrong shape", () => {
    for (const stored of ["42", '"a string"', "[1, 2, 3]", "null", "{}"]) {
      const fake = fakeStorage({ [KEYBINDINGS_STORAGE_KEY]: stored });
      expect(loadBindings(fake.storage)).toEqual(DEFAULT_BINDINGS);
    }
  });

  it("falls back to defaults on a version it does not know", () => {
    const fake = fakeStorage({
      [KEYBINDINGS_STORAGE_KEY]: blobFor({ move_up: ["KeyI"] }, KEYBINDINGS_VERSION + 1),
    });
    expect(loadBindings(fake.storage)).toEqual(DEFAULT_BINDINGS);
  });

  it("ignores unknown action names and keeps the rest", () => {
    const fake = fakeStorage({
      [KEYBINDINGS_STORAGE_KEY]: blobFor({ fly: ["KeyF"], move_up: ["KeyI"] }),
    });
    const loaded = loadBindings(fake.storage);
    expect(loaded.move_up).toEqual(["KeyI"]);
    expect(loaded.move_down).toEqual(DEFAULT_BINDINGS.move_down);
  });

  it("merges a partial stored map over the defaults", () => {
    const fake = fakeStorage({ [KEYBINDINGS_STORAGE_KEY]: blobFor({ move_left: ["KeyJ"] }) });
    const loaded = loadBindings(fake.storage);
    expect(loaded.move_left).toEqual(["KeyJ"]);
    expect(loaded.move_up).toEqual(DEFAULT_BINDINGS.move_up);
    expect(loaded.move_right).toEqual(DEFAULT_BINDINGS.move_right);
  });

  it("inv_keybindings_read_is_total", () => {
    // Any string at all in the slot -- and any throw from storage -- is a
    // playable game on defaults, never an exception.
    fc.assert(
      fc.property(fc.string(), (stored) => {
        const fake = fakeStorage({ [KEYBINDINGS_STORAGE_KEY]: stored });
        expect(() => loadBindings(fake.storage)).not.toThrow();
        const loaded = loadBindings(fake.storage);
        expect(Object.keys(loaded).sort()).toEqual(
          ["move_down", "move_left", "move_right", "move_up"].sort(),
        );
        expect(fake.writes).toEqual([]);
      }),
    );
  });
});

describe("saveBindings", () => {
  it("writes a versioned blob", () => {
    const fake = fakeStorage();
    saveBindings(fake.storage, DEFAULT_BINDINGS);
    const written = JSON.parse(fake.data.get(KEYBINDINGS_STORAGE_KEY) ?? "null");
    expect(written.version).toBe(KEYBINDINGS_VERSION);
    expect(written.bindings.move_up).toEqual(["KeyW", "ArrowUp"]);
  });

  it("reports failure rather than throwing when storage refuses the write", () => {
    const throwing: BindingsStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem() {},
    };
    expect(() => saveBindings(throwing, DEFAULT_BINDINGS)).not.toThrow();
    expect(saveBindings(throwing, DEFAULT_BINDINGS)).toBe(false);
  });

  it("reports failure with no storage at all, and never throws", () => {
    expect(saveBindings(undefined, DEFAULT_BINDINGS)).toBe(false);
    expect(saveBindings(null, DEFAULT_BINDINGS)).toBe(false);
  });

  it("reports success when the write lands", () => {
    expect(saveBindings(fakeStorage().storage, DEFAULT_BINDINGS)).toBe(true);
  });
});
