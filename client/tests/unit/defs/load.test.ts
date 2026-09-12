import { afterEach, describe, expect, it, vi } from "vitest";
import { DefsVersionMismatchError, fetchDefs } from "../../../src/defs/load";

function validPayload(version: string): Record<string, unknown> {
  return {
    generated_by: "tools/defs-build -- do not edit by hand",
    defs_version: version,
    objects: [],
    items: [],
    recipes: [],
    professions: [],
    chains: [],
    balance: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDefs", () => {
  it("fetches, parses, and returns the document when no version is expected", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => validPayload("v1"),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const defs = await fetchDefs("/defs/defs.json");

    expect(defs.defsVersion).toBe("v1");
    expect(fetchMock).toHaveBeenCalledWith("/defs/defs.json");
  });

  it("cache-busts the URL with the expected version when one is given", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => validPayload("v1"),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDefs("/defs/defs.json", "v1");

    expect(fetchMock).toHaveBeenCalledWith("/defs/defs.json?v=v1");
  });

  it("throws DefsVersionMismatchError on a stale deployment, never silently accepting it", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => validPayload("stale"),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDefs("/defs/defs.json", "fresh")).rejects.toThrow(DefsVersionMismatchError);
  });

  it("throws on a non-ok HTTP response", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDefs("/defs/defs.json")).rejects.toThrow(/responded 404/);
  });

  it("rejects a malformed body even on a 200 response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ bogus: 1 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDefs("/defs/defs.json")).rejects.toThrow();
  });
});
