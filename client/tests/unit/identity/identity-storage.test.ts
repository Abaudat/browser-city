import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  IDENTITY_STORAGE_KEY,
  readStoredToken,
  rememberFirstToken,
} from "../../../src/identity/identity-storage";
import type { SettingsStorage } from "../../../src/settings/settings-storage";
import { sizeProbe } from "../setup/size-probe";

function fakeStorage(initial: Record<string, string> = {}, opts: { failWrites?: boolean } = {}) {
  const data = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  const removals: string[] = [];
  const reads: string[] = [];
  const storage: SettingsStorage = {
    getItem(key) {
      reads.push(key);
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (opts.failWrites) throw new Error("QuotaExceededError");
      writes.push([key, value]);
      data.set(key, value);
    },
    removeItem(key) {
      removals.push(key);
      data.delete(key);
    },
  };
  return { storage, data, writes, removals, reads };
}

const stored = (token: string) => JSON.stringify({ version: 1, token });

describe("identity storage (story 4.5, FR141)", () => {
  it("lives in exactly one versioned key", () => {
    expect(IDENTITY_STORAGE_KEY).toBe("bc.identity.v1");
  });

  it("reads back what was stored", () => {
    const f = fakeStorage({ [IDENTITY_STORAGE_KEY]: stored("tok") });
    expect(readStoredToken(f.storage)).toBe("tok");
  });

  it("reads null from empty, missing or throwing storage", () => {
    expect(readStoredToken(fakeStorage().storage)).toBeNull();
    expect(readStoredToken(null)).toBeNull();
    const throwing: SettingsStorage = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {},
      removeItem() {},
    };
    expect(readStoredToken(throwing)).toBeNull();
  });

  // Reading any string at all from the key never throws, never writes and never
  // touches another key.
  it("inv_identity_token_read_is_total", () => {
    const probe = sizeProbe();
    fc.assert(
      fc.property(
        probe.over(fc.string({ maxLength: 200 }), (s) => s.length),
        (raw) => {
          const f = fakeStorage({ [IDENTITY_STORAGE_KEY]: raw });
          const token = readStoredToken(f.storage);
          expect(token === null || typeof token === "string").toBe(true);
          expect(f.writes).toEqual([]);
          expect(f.removals).toEqual([]);
          expect(new Set(f.reads)).toEqual(new Set([IDENTITY_STORAGE_KEY]));
          expect(f.data.get(IDENTITY_STORAGE_KEY)).toBe(raw);
        },
      ),
    );
    probe.expectReached(150);
  });

  it("rejects a blob of the wrong shape, version or an empty token", () => {
    for (const raw of [
      "{}",
      "null",
      "[]",
      '{"version":2,"token":"x"}',
      '{"version":1,"token":""}',
      '{"version":1,"token":5}',
      "not json",
    ]) {
      expect(readStoredToken(fakeStorage({ [IDENTITY_STORAGE_KEY]: raw }).storage)).toBeNull();
    }
  });

  describe("rememberFirstToken", () => {
    it("writes into an empty key and reports it persisted", () => {
      const f = fakeStorage();
      expect(rememberFirstToken(f.storage, "tok")).toEqual({ kind: "stored" });
      expect(f.writes).toEqual([[IDENTITY_STORAGE_KEY, stored("tok")]]);
    });

    it("never overwrites a stored token, and hands it back (a second tab raced)", () => {
      const f = fakeStorage({ [IDENTITY_STORAGE_KEY]: stored("mine") });
      expect(rememberFirstToken(f.storage, "theirs")).toEqual({
        kind: "occupied",
        token: "mine",
      });
      expect(f.writes).toEqual([]);
      expect(f.data.get(IDENTITY_STORAGE_KEY)).toBe(stored("mine"));
    });

    it("never overwrites a corrupt value either", () => {
      const f = fakeStorage({ [IDENTITY_STORAGE_KEY]: "{corrupt" });
      expect(rememberFirstToken(f.storage, "new")).toEqual({ kind: "occupied", token: null });
      expect(f.writes).toEqual([]);
      expect(f.removals).toEqual([]);
      expect(f.data.get(IDENTITY_STORAGE_KEY)).toBe("{corrupt");
    });

    it("a write that throws is reported, not thrown", () => {
      const f = fakeStorage({}, { failWrites: true });
      expect(rememberFirstToken(f.storage, "tok")).toEqual({ kind: "unwritable" });
    });

    it("a write that does not read back is reported unwritable", () => {
      const lying: SettingsStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      };
      expect(rememberFirstToken(lying, "tok")).toEqual({ kind: "unwritable" });
      expect(rememberFirstToken(null, "tok")).toEqual({ kind: "unwritable" });
    });

    it("never removes or clears anything", () => {
      const f = fakeStorage();
      rememberFirstToken(f.storage, "tok");
      expect(f.removals).toEqual([]);
    });
  });
});
