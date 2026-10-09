import { describe, expect, it } from "vitest";
import { buildL3Labels } from "../../../src/debug/l3-labels";
import { conformanceView } from "./support";

const body = (
  over: Partial<{
    id: string;
    fallbacks: number;
    paceOutOfBand: boolean;
    floor: number;
    avoidance: { offsetCells: number; capped: boolean; blocked: boolean };
    activity: string;
  }>,
) => ({
  id: "b",
  x: 1.5,
  y: 1.5,
  floor: 0,
  fallbacks: 0,
  paceOutOfBand: false,
  ...over,
});

describe("buildL3Labels", () => {
  it("says ok for a healthy body, and names each defect", () => {
    const view = {
      ...conformanceView(),
      l3Bodies: () => [body({ id: "a" }), body({ id: "b", fallbacks: 2, paceOutOfBand: true })],
    };
    const labels = buildL3Labels(view);
    expect(labels.map((l) => l.text)).toEqual(["a ok", "b straight x2 pace"]);
  });

  it("shows a sidestep and a glance", () => {
    const view = {
      ...conformanceView(),
      l3Bodies: () => [
        body({ id: "a", avoidance: { offsetCells: -0.31, capped: false, blocked: false } }),
        body({ id: "b", avoidance: { offsetCells: 0, capped: true, blocked: true } }),
        body({ id: "c", activity: "glance" }),
      ],
    };
    const labels = buildL3Labels(view);
    expect(labels.map((l) => l.text)).toEqual(["a ok side -0.31", "b cap blocked", "c ok glance"]);
    expect(labels[1]?.fill).not.toBe(labels[0]?.fill);
  });

  it("skips a body on another floor", () => {
    const view = { ...conformanceView(), l3Bodies: () => [body({ floor: 1 })] };
    expect(buildL3Labels(view)).toEqual([]);
  });

  it("flags a defect in the warning fill, not the plain one", () => {
    const view = {
      ...conformanceView(),
      l3Bodies: () => [body({ id: "a" }), body({ id: "b", fallbacks: 1 })],
    };
    const [ok, bad] = buildL3Labels(view);
    expect(ok?.fill).not.toBe(bad?.fill);
  });
});
