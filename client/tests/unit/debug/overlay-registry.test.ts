import { describe, expect, it, vi } from "vitest";
import type { DebugOverlay } from "../../../src/debug/overlay-registry";
import { DebugOverlayRegistry } from "../../../src/debug/overlay-registry";

function overlay(id: string): DebugOverlay {
  return { id, label: `the ${id} overlay`, draw: vi.fn() };
}

function registry(...ids: string[]): DebugOverlayRegistry {
  return new DebugOverlayRegistry(ids.map(overlay));
}

describe("DebugOverlayRegistry", () => {
  it("refuses two overlays sharing an id, rather than silently shadowing one", () => {
    expect(() => new DebugOverlayRegistry([overlay("collision"), overlay("collision")])).toThrow(
      /collision/,
    );
  });

  it("refuses an id that could never be typed into the ?debug= query", () => {
    for (const bad of ["", "Collision", "sort order", "a,b", "1st"]) {
      expect(() => new DebugOverlayRegistry([overlay(bad)])).toThrow();
    }
  });

  it("starts with every overlay off -- a debug tool is never on by default", () => {
    const reg = registry("collision", "sort");
    expect(reg.enabledIds()).toEqual([]);
    expect(reg.isEnabled("collision")).toBe(false);
    expect(reg.list()).toEqual([
      { id: "collision", label: "the collision overlay", enabled: false },
      { id: "sort", label: "the sort overlay", enabled: false },
    ]);
  });

  it("enables, disables and toggles by id, reporting whether it knew the id", () => {
    const reg = registry("collision", "sort");
    expect(reg.enable("collision")).toBe(true);
    expect(reg.isEnabled("collision")).toBe(true);
    expect(reg.isEnabled("sort")).toBe(false);
    expect(reg.toggle("collision")).toBe(true);
    expect(reg.isEnabled("collision")).toBe(false);
    expect(reg.toggle("collision")).toBe(true);
    expect(reg.isEnabled("collision")).toBe(true);
    expect(reg.disable("collision")).toBe(true);
    expect(reg.isEnabled("collision")).toBe(false);
  });

  it("is idempotent: enabling twice and disabling twice change nothing", () => {
    const reg = registry("collision");
    reg.enable("collision");
    reg.enable("collision");
    expect(reg.enabledIds()).toEqual(["collision"]);
    reg.disable("collision");
    reg.disable("collision");
    expect(reg.enabledIds()).toEqual([]);
  });

  it("ignores an unknown id instead of throwing, and says it did not know it", () => {
    const reg = registry("collision");
    expect(reg.enable("navmesh")).toBe(false);
    expect(reg.disable("navmesh")).toBe(false);
    expect(reg.toggle("navmesh")).toBe(false);
    expect(reg.isEnabled("navmesh")).toBe(false);
    expect(reg.enabledIds()).toEqual([]);
  });

  it("reports enabled ids in registration order, whatever order they were enabled in", () => {
    const reg = registry("collision", "sort", "navmesh");
    reg.enable("navmesh");
    reg.enable("collision");
    expect(reg.enabledIds()).toEqual(["collision", "navmesh"]);
  });

  it("hands back the overlay descriptor itself, so a mount can draw it", () => {
    const one = overlay("collision");
    const reg = new DebugOverlayRegistry([one]);
    expect(reg.overlay("collision")).toBe(one);
    expect(reg.overlay("navmesh")).toBeUndefined();
    expect(reg.overlays()).toEqual([one]);
  });

  it("knows nothing about drawing -- no overlay is ever drawn by enabling it", () => {
    const one = overlay("collision");
    const reg = new DebugOverlayRegistry([one]);
    reg.enable("collision");
    reg.toggle("collision");
    expect(one.draw).not.toHaveBeenCalled();
  });
});
