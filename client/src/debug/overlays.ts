// The one mount, and the one list of registered overlays (story 1.12).
//
// `main.ts` reaches this module through exactly one DEV-guarded dynamic
// import, and nothing else under `client/src/` may import anything under
// `debug/` at all (`client/biome.json`'s override and
// `scripts/ci/check-debug-boundary.sh`). Because that import sits inside
// an `import.meta.env.DEV` branch that Vite statically evaluates to
// `false` for a production build, Rollup never emits this chunk: a
// production build does not contain the overlays *switched off*, it does
// not contain them (AC1).
//
// Adding an overlay is one file under `debug/` exporting a `DebugOverlay`
// plus one line in `DEBUG_OVERLAYS` below. It then inherits
// `overlay-conformance.ts`'s whole contract, the `?debug=` activation,
// the `__bcDebug` handle and the production off-means-off e2e check,
// which drives its list from this same table -- that is AC5, mechanically
// rather than as a convention.
//
// What a redraw costs, stated plainly, because an overlay author is
// charged for it (Quentin's direction, cycle 2). There is no ticker: a
// redraw happens only on an event, but "only on an event" is not the same
// as "rarely", and these are the events and their real rates:
//
//   - the camera moving (`setViewTransform`): once, at mount, in this
//     scene. A real, followed camera would make it per-frame-ish while
//     the player walks.
//   - the order changing (`main.ts`'s `onOrderChange`): every frame in
//     which the player's own FR123 sort key changes -- so roughly
//     `SORT_SUBDIVISIONS` times per tile walked, i.e. **every frame while
//     walking** in practice, and never while standing still.
//   - the player's cell or floor changing (`main.ts`'s `onPlayerMove`,
//     deliberately gated down from its own per-frame callback): once per
//     tile crossed.
//   - `enable`/`disable`/`toggle`: once each, on demand.
//
// So with `?debug=sort` on and the player walking, every label element is
// rebuilt every frame. That is an acceptable price for a dev tool and the
// viewport culling is what bounds it -- a `draw` whose cost is not
// bounded by the viewport will be felt. With every overlay off, `redraw`
// returns before touching the world at all, so none of the above costs
// anything.

import { collisionOverlay } from "./collision-overlay";
import { DEBUG_ROOT_MARKER, DEBUG_VIEW_MARKER } from "./debug-markers";
import { parseDebugQuery, unknownOverlayWarning } from "./debug-query";
import type { DebugOverlay, DebugOverlayEntry } from "./overlay-registry";
import { DebugOverlayRegistry } from "./overlay-registry";
import { sortOverlay } from "./sort-overlay";
import { clearGroup, svgElement } from "./svg";
import type { DebugWorldView } from "./world-view";

/** Every overlay this build knows about, in draw order. */
export const DEBUG_OVERLAYS: readonly DebugOverlay[] = [collisionOverlay, sortOverlay];

declare global {
  interface Window {
    /** DEV-only, like `window.__bc`: the registry's own controls, for a
     * devtools console and for Playwright. Never present in a production
     * build, because this whole module is never in one. */
    __bcDebug?: {
      list(): readonly DebugOverlayEntry[];
      enable(id: string): boolean;
      disable(id: string): boolean;
      toggle(id: string): boolean;
      redraw(): void;
    };
  }
}

export interface MountDebugOverlaysOptions {
  /** The canvas mount (`#test-street`), never `document.body`: FR151's
   * DOM-surface allowlist is checked against `document.body`'s own
   * children, and a debug overlay is not a UI surface. */
  readonly mount: HTMLElement;
  /** The renderer's own logical size, *read on every redraw* -- the
   * coordinate space the scene's world container is positioned in, which
   * is what the `viewBox` has to match for `screen-position.ts`'s output
   * to land where the renderer drew.
   *
   * A getter rather than two numbers (Tim's direction, cycle 2): captured
   * once, this would be correct only because `test-street/scene.ts`
   * happens to do its final `resize` before `mountStreetScene` resolves
   * and never resize again. Epic 3's real, resizable camera would inherit
   * that as a silently misaligned overlay -- every hairline off by
   * whatever the window did since boot. */
  readonly rendererSize: () => { readonly width: number; readonly height: number };
  readonly view: DebugWorldView;
  /** `window.location.search`, injected. */
  readonly search?: string;
  readonly warn?: (message: string) => void;
  /** Overridable so the conformance suite can mount a registry of its
   * own; production always takes `DEBUG_OVERLAYS`. */
  readonly overlays?: readonly DebugOverlay[];
  /** Injected so a test can mount without a `window` (and so this module
   * never reaches for a global it was not given). */
  readonly exposeOn?: Window;
}

export interface DebugOverlaysHandle {
  readonly registry: DebugOverlayRegistry;
  readonly root: SVGSVGElement;
  list(): readonly DebugOverlayEntry[];
  enable(id: string): boolean;
  disable(id: string): boolean;
  toggle(id: string): boolean;
  /** The scene's own camera, as `onViewTransform` reports it. */
  setViewTransform(zoom: number, offsetX: number, offsetY: number): void;
  redraw(): void;
  destroy(): void;
}

/**
 * Mounts the overlay surface and returns its controls. Draws nothing
 * until an overlay is enabled, and does no work at all -- not one grid
 * query -- on any event while every overlay is off, so a session that
 * never asks for an overlay pays exactly nothing for this existing
 * (NFR2's budget in `street-perf.spec.ts` is untouched by this story).
 *
 * There is no ticker: a redraw happens on the scene's own events (the
 * camera moving, the order changing, the player moving), never per frame.
 */
export function mountDebugOverlays(options: MountDebugOverlaysOptions): DebugOverlaysHandle {
  const { mount, view, rendererSize } = options;
  const doc = mount.ownerDocument;
  const registry = new DebugOverlayRegistry(options.overlays ?? DEBUG_OVERLAYS);
  const warn = options.warn ?? ((message: string) => console.warn(message));

  const root = svgElement(doc, "svg", {
    // Never `data-bc-surface`: that attribute is FR151's DOM UI
    // allowlist, and this is not one of the three surfaces.
    "data-bc-debug": DEBUG_ROOT_MARKER,
    preserveAspectRatio: "xMinYMin meet",
  });

  /** Re-reads the renderer's logical size, so a resize can never leave
   * the overlay projecting into a box the scene no longer draws in. */
  function applyViewBox(): void {
    const { width, height } = rendererSize();
    root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  applyViewBox();
  root.style.position = "absolute";
  root.style.inset = "0";
  root.style.width = "100%";
  root.style.height = "100%";
  // A measuring tool must never eat a click meant for the world.
  root.style.pointerEvents = "none";

  // The canvas mount is a plain, statically positioned div; the overlay
  // has to be positioned against its box to line up with the canvas
  // inside it. DEV-only, and the only change this module makes to
  // anything it did not create.
  if (doc.defaultView?.getComputedStyle(mount).position === "static") {
    mount.style.position = "relative";
  }

  const viewGroup = svgElement(doc, "g", { "data-bc-debug": DEBUG_VIEW_MARKER });
  root.appendChild(viewGroup);
  mount.appendChild(root);

  const groups = new Map<string, SVGGElement>();

  function groupFor(id: string): SVGGElement {
    const existing = groups.get(id);
    if (existing) return existing;
    const group = svgElement(doc, "g", { "data-bc-debug": id });
    groups.set(id, group);
    viewGroup.appendChild(group);
    return group;
  }

  function redraw(): void {
    const enabled = registry.enabledIds();
    // A disabled overlay leaves nothing behind -- its whole group goes,
    // rather than being emptied and kept.
    for (const [id, group] of [...groups]) {
      if (enabled.includes(id)) continue;
      group.remove();
      groups.delete(id);
    }
    // The whole of "an overlay that is not enabled costs nothing": this
    // returns before touching `view` at all, so no grid query, no object
    // enumeration and no allocation happens on any event while every
    // overlay is off.
    if (enabled.length === 0) return;
    // Only once something is actually drawn -- so "every overlay off
    // costs nothing" stays literally true, including this read.
    applyViewBox();
    for (const overlay of registry.overlays()) {
      if (!enabled.includes(overlay.id)) continue;
      const group = groupFor(overlay.id);
      clearGroup(group);
      overlay.draw(group, view);
    }
  }

  function setViewTransform(zoom: number, offsetX: number, offsetY: number): void {
    viewGroup.setAttribute("transform", `matrix(${zoom} 0 0 ${zoom} ${offsetX} ${offsetY})`);
    redraw();
  }

  const handle: DebugOverlaysHandle = {
    registry,
    root,
    list: () => registry.list(),
    enable: (id) => {
      const known = registry.enable(id);
      redraw();
      return known;
    },
    disable: (id) => {
      const known = registry.disable(id);
      redraw();
      return known;
    },
    toggle: (id) => {
      const known = registry.toggle(id);
      redraw();
      return known;
    },
    setViewTransform,
    redraw,
    destroy: () => {
      root.remove();
      groups.clear();
      const host = options.exposeOn;
      if (host?.__bcDebug) host.__bcDebug = undefined;
    },
  };

  const query = parseDebugQuery(
    options.search ?? "",
    registry.overlays().map((o) => o.id),
  );
  for (const id of query.ids) registry.enable(id);
  if (query.unknown.length > 0) {
    warn(
      unknownOverlayWarning(
        query.unknown,
        registry.overlays().map((o) => o.id),
      ),
    );
  }
  redraw();

  const host = options.exposeOn;
  if (host) {
    host.__bcDebug = {
      list: handle.list,
      enable: handle.enable,
      disable: handle.disable,
      toggle: handle.toggle,
      redraw: handle.redraw,
    };
  }

  return handle;
}
