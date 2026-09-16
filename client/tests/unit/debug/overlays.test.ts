// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEBUG_OVERLAYS, mountDebugOverlays } from "../../../src/debug/overlays";
import { conformanceView, countingView } from "./support";

function mount(options: Partial<Parameters<typeof mountDebugOverlays>[0]> = {}) {
  const host = document.createElement("div");
  host.id = "test-street";
  document.body.appendChild(host);
  return mountDebugOverlays({
    mount: host,
    viewBoxWidth: 640,
    viewBoxHeight: 480,
    view: conformanceView(),
    warn: () => {},
    ...options,
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mountDebugOverlays", () => {
  it("mounts one SVG inside the canvas mount, never in document.body (FR151)", () => {
    const handle = mount();
    const root = document.querySelector('[data-bc-debug="overlays"]');
    expect(root?.parentElement?.id).toBe("test-street");
    // FR151's allowlist is checked against document.body's own children;
    // nothing here may look like one of the three DOM UI surfaces.
    expect(document.querySelectorAll("[data-bc-surface]")).toHaveLength(0);
    expect(handle.root.getAttribute("viewBox")).toBe("0 0 640 480");
    handle.destroy();
  });

  it("never eats a click meant for the world", () => {
    const handle = mount();
    expect(handle.root.style.pointerEvents).toBe("none");
    handle.destroy();
  });

  it("draws nothing at all until an overlay is asked for", () => {
    const handle = mount();
    expect(handle.root.querySelectorAll("[data-bc-collider]")).toHaveLength(0);
    expect(handle.list().every((e) => !e.enabled)).toBe(true);
    handle.destroy();
  });

  it("does no work whatsoever on an event while every overlay is off (NFR2)", () => {
    const counting = countingView(conformanceView());
    const handle = mount({ view: counting.view });
    handle.setViewTransform(3, 10, 20);
    handle.redraw();
    handle.redraw();
    expect(counting.reads()).toBe(0);
    // ...and it starts reading the moment one is switched on, so the
    // zero above is really "nothing to do", not "nothing wired".
    handle.enable("collision");
    expect(counting.reads()).toBeGreaterThan(0);
    handle.destroy();
  });

  it("activates exactly what ?debug= names, ignoring what it does not know", () => {
    const warn = vi.fn();
    const handle = mount({ search: "?debug=collision,navmesh", warn });
    expect(handle.list().find((e) => e.id === "collision")?.enabled).toBe(true);
    expect(handle.list().find((e) => e.id === "sort")?.enabled).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("navmesh"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("collision, sort"));
    handle.destroy();
  });

  it("draws the collision overlay's three states as three distinguishable elements (AC2)", () => {
    const handle = mount({ search: "?debug=collision" });
    const group = handle.root.querySelector('[data-bc-debug="collision"]');
    expect(group?.querySelectorAll('[data-bc-collider="collider"]')).toHaveLength(1);
    expect(group?.querySelectorAll('[data-bc-collider="none"]')).toHaveLength(1);
    expect(group?.querySelectorAll('[data-bc-collider="empty"]')).toHaveLength(1);
    // The one with no collider is an unfilled, dashed outline; the real
    // one is filled. A reader can tell them apart without a legend.
    const none = group?.querySelector('[data-bc-collider="none"]');
    expect(none?.getAttribute("fill")).toBe("none");
    expect(none?.getAttribute("stroke-dasharray")).toBeTruthy();
    const real = group?.querySelector('[data-bc-collider="collider"]');
    expect(real?.getAttribute("fill")).not.toBe("none");
    handle.destroy();
  });

  it("draws a sort key and its resolved order for every pool member (AC3)", () => {
    const handle = mount({ search: "?debug=sort" });
    const labels = handle.root.querySelectorAll("[data-bc-sort-label]");
    expect(labels).toHaveLength(2);
    expect(labels[0]?.textContent).toContain("y0 r20 x0 #1");
    expect(labels[0]?.textContent).toContain("[0]");
    handle.destroy();
  });

  it("carries the scene's own camera on one root group, never per element", () => {
    const handle = mount({ search: "?debug=collision" });
    handle.setViewTransform(3, 12, -4);
    const viewGroup = handle.root.querySelector('[data-bc-debug="view"]');
    expect(viewGroup?.getAttribute("transform")).toBe("matrix(3 0 0 3 12 -4)");
    expect(viewGroup?.querySelector('[data-bc-debug="collision"]')).not.toBeNull();
    handle.destroy();
  });

  it("redrawing an unchanged world replaces its elements rather than adding to them", () => {
    const handle = mount({ search: "?debug=collision,sort" });
    const before = handle.root.querySelectorAll("*").length;
    handle.redraw();
    handle.redraw();
    expect(handle.root.querySelectorAll("*").length).toBe(before);
    handle.destroy();
  });

  it("exposes the registry's controls on window.__bcDebug for devtools and Playwright", () => {
    const handle = mount({ exposeOn: window });
    expect(window.__bcDebug?.list().map((e) => e.id)).toEqual(DEBUG_OVERLAYS.map((o) => o.id));
    expect(window.__bcDebug?.enable("collision")).toBe(true);
    expect(document.querySelectorAll("[data-bc-collider]").length).toBeGreaterThan(0);
    expect(window.__bcDebug?.toggle("collision")).toBe(true);
    expect(document.querySelectorAll("[data-bc-collider]")).toHaveLength(0);
    expect(window.__bcDebug?.enable("navmesh")).toBe(false);
    handle.destroy();
    expect(window.__bcDebug).toBeUndefined();
  });

  it("leaves the page exactly as it found it when destroyed", () => {
    const handle = mount({ search: "?debug=collision,sort" });
    handle.destroy();
    expect(document.querySelectorAll("[data-bc-debug]")).toHaveLength(0);
  });

  it("warns through the console when no warning sink was injected", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    const handle = mountDebugOverlays({
      mount: host,
      viewBoxWidth: 10,
      viewBoxHeight: 10,
      view: conformanceView(),
      search: "?debug=navmesh",
    });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("navmesh"));
    spy.mockRestore();
    handle.destroy();
  });

  it("leaves a mount that already positions itself alone", () => {
    const host = document.createElement("div");
    host.style.position = "absolute";
    document.body.appendChild(host);
    const handle = mountDebugOverlays({
      mount: host,
      viewBoxWidth: 10,
      viewBoxHeight: 10,
      view: conformanceView(),
      warn: () => {},
    });
    expect(host.style.position).toBe("absolute");
    handle.destroy();
  });

  it("positions itself against the canvas mount rather than the page", () => {
    const host = document.createElement("div");
    host.id = "test-street";
    document.body.appendChild(host);
    const handle = mountDebugOverlays({
      mount: host,
      viewBoxWidth: 10,
      viewBoxHeight: 10,
      view: conformanceView(),
      warn: () => {},
    });
    expect(host.style.position).toBe("relative");
    handle.destroy();
  });
});
