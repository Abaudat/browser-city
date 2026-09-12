import { describe, expect, it } from "vitest";
import { canonicalDump, DefsParseError, parseDefs } from "../../../src/defs/parse";
import type { Defs } from "../../../src/defs/types";

function validPayload(): Record<string, unknown> {
  return {
    generated_by: "tools/defs-build -- do not edit by hand",
    defs_version: "abc123",
    objects: [{ id: 1, key: "trash_bin", width: 1, height: 1 }],
    items: [
      { id: 1, key: "bottle" },
      { id: 2, key: "recycled_glass" },
    ],
    recipes: [{ id: 1, key: "bottle_recycling", inputs: ["bottle"], outputs: ["recycled_glass"] }],
    professions: [{ id: 1, key: "sanitation_worker" }],
    chains: [{ id: 1, key: "plastic_bottle", links: ["sanitation_worker"] }],
    balance: [{ key: "citizen.bar_decay.rest", value: 10, min: 0, max: 100 }],
  };
}

describe("parseDefs", () => {
  it("parses a well-formed document into the plain Defs shape", () => {
    const defs = parseDefs(validPayload());
    expect(defs.defsVersion).toBe("abc123");
    expect(defs.objects).toEqual([{ id: 1, key: "trash_bin", width: 1, height: 1 }]);
    expect(defs.recipes[0]?.inputs).toEqual(["bottle"]);
  });

  it("rejects a non-object document", () => {
    expect(() => parseDefs("nope")).toThrow(DefsParseError);
    expect(() => parseDefs(null)).toThrow(DefsParseError);
    expect(() => parseDefs([])).toThrow(DefsParseError);
  });

  it("rejects an unknown top-level field", () => {
    const payload = { ...validPayload(), bogus: 1 };
    expect(() => parseDefs(payload)).toThrow(/unknown field 'bogus'/);
  });

  it("rejects an unknown field on one entry", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: 1, key: "bottle", bogus: 2 };
    expect(() => parseDefs(payload)).toThrow(/unknown field 'bogus'/);
  });

  it("rejects a missing required field", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected a number/);
  });

  it("rejects a wrong value type", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: "nope", key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected a number/);
  });

  it("rejects a non-integer id, never accepting what the module could not have produced", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: 1.5, key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected an integer in \[0, 2\^32\)/);
  });

  it("rejects a negative id", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: -1, key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected an integer in \[0, 2\^32\)/);
  });

  it("rejects an id at or above 2^32", () => {
    const payload = validPayload();
    (payload.items as Record<string, unknown>[])[0] = { id: 2 ** 32, key: "bottle" };
    expect(() => parseDefs(payload)).toThrow(/expected an integer in \[0, 2\^32\)/);
  });

  it("rejects a non-integer balance value", () => {
    const payload = validPayload();
    payload.balance = [{ key: "a", value: 1.5, min: 0, max: 10 }];
    expect(() => parseDefs(payload)).toThrow(/expected an integer/);
  });

  it("rejects a duplicate id within one kind", () => {
    const payload = validPayload();
    payload.items = [
      { id: 1, key: "bottle" },
      { id: 1, key: "recycled_glass" },
    ];
    expect(() => parseDefs(payload)).toThrow(/duplicate item id 1/);
  });

  it("rejects a duplicate key within one kind", () => {
    const payload = validPayload();
    payload.items = [
      { id: 1, key: "bottle" },
      { id: 2, key: "bottle" },
    ];
    expect(() => parseDefs(payload)).toThrow(/duplicate item key 'bottle'/);
  });

  it("rejects a recipe naming an unknown item in inputs", () => {
    const payload = validPayload();
    payload.recipes = [{ id: 1, key: "r", inputs: ["nope"], outputs: [] }];
    expect(() => parseDefs(payload)).toThrow(/unknown item 'nope' in inputs/);
  });

  it("rejects a recipe naming an unknown item in outputs", () => {
    const payload = validPayload();
    payload.recipes = [{ id: 1, key: "r", inputs: [], outputs: ["nope"] }];
    expect(() => parseDefs(payload)).toThrow(/unknown item 'nope' in outputs/);
  });

  it("rejects a chain naming an unknown profession", () => {
    const payload = validPayload();
    payload.chains = [{ id: 1, key: "c", links: ["nope"] }];
    expect(() => parseDefs(payload)).toThrow(/unknown profession 'nope'/);
  });

  it("rejects an out-of-range balance value", () => {
    const payload = validPayload();
    payload.balance = [{ key: "a", value: 999, min: 0, max: 10 }];
    expect(() => parseDefs(payload)).toThrow(/out of its own declared range/);
  });

  it("accepts a balance value at the boundary", () => {
    const payload = validPayload();
    payload.balance = [{ key: "a", value: 10, min: 0, max: 10 }];
    expect(() => parseDefs(payload)).not.toThrow();
  });
});

describe("canonicalDump", () => {
  it("sorts every kind by key and formats every field in a fixed order", () => {
    const defs: Defs = parseDefs(validPayload());
    const dump = canonicalDump(defs);
    expect(dump).toBe(
      [
        "balance citizen.bar_decay.rest value=10 min=0 max=100",
        "chain plastic_bottle id=1 links=[sanitation_worker]",
        "item bottle id=1",
        "item recycled_glass id=2",
        "object trash_bin id=1 height=1 width=1",
        "profession sanitation_worker id=1",
        "recipe bottle_recycling id=1 inputs=[bottle] outputs=[recycled_glass]",
        "",
      ].join("\n"),
    );
  });
});
