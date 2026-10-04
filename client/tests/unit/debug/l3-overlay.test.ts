// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { l3Overlay } from "../../../src/debug/l3-overlay";
import { conformanceView } from "./support";

describe("the L3 overlay", () => {
  it("draws one readout per live body, naming its defects", () => {
    const view = {
      ...conformanceView(),
      l3Bodies: () => [
        { id: "a", x: 1.5, y: 1.5, floor: 0, fallbacks: 0, paceOutOfBand: false },
        { id: "b", x: 2.5, y: 1.5, floor: 0, fallbacks: 1, paceOutOfBand: true },
      ],
    };
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    l3Overlay.draw(group, view);
    const texts = Array.from(group.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toEqual(["a ok", "b straight x1 pace"]);
  });

  it("draws nothing when no body is live", () => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    l3Overlay.draw(group, conformanceView());
    expect(group.childElementCount).toBe(0);
  });
});
