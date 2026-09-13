import { describe, expect, it } from "vitest";
import { cellsForRange } from "../../../src/world/subcells";

describe("cellsForRange", () => {
  it("an interval exactly filling one cell touches only that cell", () => {
    expect(cellsForRange(0, 16, 16)).toEqual([0, 0]);
  });

  it("an interval starting exactly on a boundary and reaching one sub-cell past it touches the next cell too", () => {
    expect(cellsForRange(0, 17, 16)).toEqual([0, 1]);
  });

  it("touching a boundary exactly does not reach into the next cell (half-open)", () => {
    expect(cellsForRange(15, 16, 16)).toEqual([0, 0]);
    expect(cellsForRange(16, 17, 16)).toEqual([1, 1]);
  });

  it("negative sub-cell coordinates floor-divide correctly", () => {
    expect(cellsForRange(-16, -1, 16)).toEqual([-1, -1]);
    expect(cellsForRange(-1, 1, 16)).toEqual([-1, 0]);
  });
});
