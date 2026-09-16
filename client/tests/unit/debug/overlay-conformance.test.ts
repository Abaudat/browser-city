// @vitest-environment jsdom
// AC5, mechanically: every registered overlay is run through the one
// shared contract, table-driven off the registry itself. A navmesh, chunk
// or citizen-route overlay added later is covered by this file on the day
// it is added to `DEBUG_OVERLAYS` -- with no new test file, which is the
// whole point (Quentin's direction).
import { describe, expect, it } from "vitest";
import { checkOverlayConformance } from "../../../src/debug/overlay-conformance";
import type { DebugOverlay } from "../../../src/debug/overlay-registry";
import { DEBUG_OVERLAYS, mountDebugOverlays } from "../../../src/debug/overlays";
import { conformanceView } from "./support";

function mount(overlays?: readonly DebugOverlay[]) {
  const host = document.createElement("div");
  host.id = "test-street";
  document.body.appendChild(host);
  return mountDebugOverlays({
    mount: host,
    viewBoxWidth: 640,
    viewBoxHeight: 480,
    view: conformanceView(),
    warn: () => {},
    ...(overlays ? { overlays } : {}),
  });
}

describe("every registered debug overlay", () => {
  it("satisfies the shared overlay contract", () => {
    const handle = mount();
    expect(checkOverlayConformance(handle)).toEqual([]);
    handle.destroy();
  });

  it("covers every overlay this build registers, by name", () => {
    // So that a future overlay cannot be added to `DEBUG_OVERLAYS`
    // without this suite noticing it exists.
    const handle = mount();
    expect(handle.list().map((e) => e.id)).toEqual(DEBUG_OVERLAYS.map((o) => o.id));
    expect(handle.list().length).toBeGreaterThan(0);
    handle.destroy();
  });
});

// A contract suite nobody has seen fail is not a contract suite.
describe("the overlay contract itself", () => {
  it("catches an overlay that paints outside the shared palette", () => {
    const rogue: DebugOverlay = {
      id: "rogue",
      label: "rogue",
      draw: (group) => {
        const rect = group.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("fill", "#8b7355"); // a muted, tileset-like brown
        group.appendChild(rect);
      },
    };
    const handle = mount([rogue]);
    expect(checkOverlayConformance(handle).join("\n")).toContain("#8b7355");
    handle.destroy();
  });

  it("catches an overlay that accumulates elements instead of redrawing", () => {
    let drawn = 0;
    const leaky: DebugOverlay = {
      id: "leaky",
      label: "leaky",
      draw: (group) => {
        drawn++;
        for (let i = 0; i < drawn; i++) {
          group.appendChild(
            group.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect"),
          );
        }
      },
    };
    const handle = mount([leaky]);
    expect(checkOverlayConformance(handle).join("\n")).toContain("element count");
    handle.destroy();
  });

  it("catches an overlay that draws nothing at all when enabled", () => {
    const silent: DebugOverlay = { id: "silent", label: "", draw: () => {} };
    const handle = mount([silent]);
    // An unlabelled overlay is unreadable in `__bcDebug.list()`.
    expect(checkOverlayConformance(handle).join("\n")).toContain("no label");
    handle.destroy();
  });

  it("catches a registry with nothing in it", () => {
    const handle = mount([]);
    expect(checkOverlayConformance(handle).join("\n")).toContain("no overlay is registered");
    handle.destroy();
  });
});
