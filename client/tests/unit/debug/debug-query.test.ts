import { describe, expect, it } from "vitest";
import { parseDebugQuery, unknownOverlayWarning } from "../../../src/debug/debug-query";

const KNOWN = ["collision", "sort"];

describe("parseDebugQuery", () => {
  it("is absent when nothing asked for it -- the query is opt-in", () => {
    expect(parseDebugQuery("", KNOWN)).toEqual({ ids: [], unknown: [], present: false });
    expect(parseDebugQuery("?freezeCrowd", KNOWN).present).toBe(false);
  });

  it("selects the overlays a comma-separated list names", () => {
    expect(parseDebugQuery("?debug=collision,sort", KNOWN).ids).toEqual(["collision", "sort"]);
  });

  it("keeps the order written, and never activates one twice", () => {
    expect(parseDebugQuery("?debug=sort,collision,sort", KNOWN).ids).toEqual(["sort", "collision"]);
  });

  it("tolerates whitespace and empty entries rather than failing the boot", () => {
    expect(parseDebugQuery("?debug=  collision , ,sort ", KNOWN).ids).toEqual([
      "collision",
      "sort",
    ]);
    expect(parseDebugQuery("?debug=", KNOWN)).toEqual({ ids: [], unknown: [], present: true });
  });

  it("reports an unknown id instead of activating or throwing on it", () => {
    const parsed = parseDebugQuery("?debug=collision,navmesh,navmesh", KNOWN);
    expect(parsed.ids).toEqual(["collision"]);
    expect(parsed.unknown).toEqual(["navmesh"]);
  });

  it("names the overlays that do exist, so the next thing typed is right", () => {
    expect(unknownOverlayWarning(["navmesh"], KNOWN)).toBe(
      "[debug] no such overlay: navmesh -- known overlays: collision, sort",
    );
  });

  it("reads `debug` out of a query carrying other parameters too", () => {
    expect(parseDebugQuery("?freezeCrowd&debug=sort", KNOWN).ids).toEqual(["sort"]);
  });
});
