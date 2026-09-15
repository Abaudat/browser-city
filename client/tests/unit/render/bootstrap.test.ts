// @vitest-environment jsdom
// Story 1.1's ping indicator, now plain DOM (story 1.13: the page has one
// Pixi Application, the street scene's, not a second one for this).
import { describe, expect, it } from "vitest";
import { bootstrapRenderer } from "../../../src/render/bootstrap";

function observation(id: bigint) {
  return { id, message: "hi", writtenAtMs: 0, observedAtMs: 0 };
}

describe("bootstrapRenderer", () => {
  it("mounts exactly one element into mountEl", () => {
    const mount = document.createElement("div");
    bootstrapRenderer(mount);
    expect(mount.children).toHaveLength(1);
  });

  it("recolours the same element on every ping, cycling a fixed palette by id", () => {
    const mount = document.createElement("div");
    const renderer = bootstrapRenderer(mount);
    const dot = mount.firstElementChild as HTMLElement;

    renderer.showPing(observation(0n));
    const first = dot.style.background;
    renderer.showPing(observation(1n));
    const second = dot.style.background;

    expect(first).not.toBe("");
    expect(second).not.toBe("");
    expect(second).not.toBe(first);
    expect(mount.children).toHaveLength(1);
  });

  it("wraps around the palette rather than throwing on a large id", () => {
    const mount = document.createElement("div");
    const renderer = bootstrapRenderer(mount);
    expect(() => renderer.showPing(observation(1_000_000_007n))).not.toThrow();
  });
});
