// Story 2.8 (FR147): the handshake's own decision, pure -- no window, no
// fetch, no storage (Quentin's direction). Every branch table-tested,
// including the second-mismatch-after-reload case (Tim's direction) and
// a missing/empty/malformed remote version never reading as a match
// (Quentin's direction).
import { describe, expect, it } from "vitest";
import { decideHandshake, decideReload, markVerified } from "../../../src/boot/handshake";
import type { Defs } from "../../../src/defs/types";

const V1 = { defsVersion: "d1", protocolVersion: "p1" };
const V2_DEFS = { defsVersion: "d2", protocolVersion: "p1" };
const V2_PROTOCOL = { defsVersion: "d1", protocolVersion: "p2" };

describe("decideHandshake", () => {
  it("both equal -> proceed", () => {
    expect(decideHandshake(V1, V1, undefined)).toBe("proceed");
  });

  it("only defs_version differs -> refetch-defs", () => {
    expect(decideHandshake(V2_DEFS, V1, undefined)).toBe("refetch-defs");
  });

  it("protocol_version differs -> reload, regardless of whether defs also differs", () => {
    expect(decideHandshake(V2_PROTOCOL, V1, undefined)).toBe("reload");
    expect(decideHandshake({ defsVersion: "d2", protocolVersion: "p2" }, V1, undefined)).toBe(
      "reload",
    );
  });

  it("protocol_version differs, but this server version was already reloaded for -> updating", () => {
    expect(decideHandshake(V2_PROTOCOL, V1, V2_PROTOCOL)).toBe("updating");
  });

  it("a reload recorded for a *different* server version does not suppress a fresh reload", () => {
    expect(decideHandshake(V2_PROTOCOL, V1, { defsVersion: "dX", protocolVersion: "pX" })).toBe(
      "reload",
    );
  });

  it("a missing/empty remote defs_version never reads as a match", () => {
    expect(decideHandshake({ defsVersion: "", protocolVersion: "p1" }, V1, undefined)).toBe(
      "refetch-defs",
    );
  });

  it("a missing/empty remote protocol_version never reads as a match", () => {
    expect(decideHandshake({ defsVersion: "d1", protocolVersion: "" }, V1, undefined)).toBe(
      "reload",
    );
  });

  it("both empty never reads as a match against a real client version", () => {
    expect(decideHandshake({ defsVersion: "", protocolVersion: "" }, V1, undefined)).not.toBe(
      "proceed",
    );
  });
});

describe("decideReload", () => {
  it("no prior reload recorded -> reload", () => {
    expect(decideReload(V1, undefined)).toBe("reload");
  });

  it("a prior reload recorded for this exact server version -> updating", () => {
    expect(decideReload(V1, V1)).toBe("updating");
  });

  it("a prior reload recorded for a different server version -> reload", () => {
    expect(decideReload(V1, V2_DEFS)).toBe("reload");
  });
});

describe("markVerified", () => {
  it("returns the same defs object, just typed as verified", () => {
    const defs = { defsVersion: "d1" } as unknown as Defs;
    expect(markVerified(defs)).toBe(defs);
  });
});
