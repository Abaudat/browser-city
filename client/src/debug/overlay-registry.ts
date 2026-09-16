// The framework half of story 1.12's AC5: the one way a debug overlay
// exists. A later navmesh, chunk-boundary or citizen-route overlay is one
// file under `debug/` exporting a `DebugOverlay` plus one line in
// `debug/overlays.ts`'s list -- and it inherits `overlay-conformance.ts`'s
// whole contract suite without writing a test file of its own.
//
// Pure: no DOM, no `pixi.js`, no scene. This module decides *which*
// overlays are on, never draws one and never holds a drawn thing --
// `debug/overlays.ts` owns every element that reaches the page, so
// "enabled" can never drift from "drawn".

import { RESERVED_OVERLAY_IDS } from "./debug-markers";
import type { DebugWorldView } from "./world-view";

/**
 * Ids are what `?debug=` carries, so the id *is* the activation: lower
 * case, starting with a letter, no separator a comma-split query could
 * mangle. There is no keyboard activation in this story -- `input/` is
 * the only DOM input reader in this client and a dev tool is not a reason
 * to widen that rule (Tim's direction).
 */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** One registered overlay. `draw` is handed an empty group each time --
 * it appends, it never has to clean up after itself (`debug/overlays.ts`
 * clears and removes groups), and it never reads anything but `view`. */
export interface DebugOverlay {
  readonly id: string;
  /** Human-readable, for `__bcDebug.list()` in a devtools console. */
  readonly label: string;
  draw(group: SVGGElement, view: DebugWorldView): void;
}

/** What `list()` reports: the registry's own table, plus whether each
 * entry is on right now. */
export interface DebugOverlayEntry {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
}

export class DebugOverlayRegistry {
  private readonly byId = new Map<string, DebugOverlay>();
  private readonly enabled = new Set<string>();

  /** Registration order is fixed at construction and is the order
   * everything reports in, so two overlays never race to be listed (or
   * drawn) first. */
  constructor(overlays: readonly DebugOverlay[]) {
    for (const overlay of overlays) {
      if (!ID_PATTERN.test(overlay.id)) {
        throw new Error(
          `DebugOverlayRegistry: '${overlay.id}' is not a usable overlay id -- ids are what ?debug= carries, so they must match ${String(ID_PATTERN)}`,
        );
      }
      if (RESERVED_OVERLAY_IDS.includes(overlay.id)) {
        throw new Error(
          `DebugOverlayRegistry: '${overlay.id}' is reserved by the overlay surface itself (debug-markers.ts) -- an overlay registered under it would resolve to the surface's own group instead of its own`,
        );
      }
      if (this.byId.has(overlay.id)) {
        throw new Error(
          `DebugOverlayRegistry: two overlays registered as '${overlay.id}' -- an id is how an overlay is activated, so it can only mean one thing`,
        );
      }
      this.byId.set(overlay.id, overlay);
    }
  }

  /** Every registered overlay, in registration order. */
  overlays(): readonly DebugOverlay[] {
    return [...this.byId.values()];
  }

  overlay(id: string): DebugOverlay | undefined {
    return this.byId.get(id);
  }

  list(): readonly DebugOverlayEntry[] {
    return this.overlays().map((o) => ({
      id: o.id,
      label: o.label,
      enabled: this.enabled.has(o.id),
    }));
  }

  /** In registration order, never activation order. */
  enabledIds(): readonly string[] {
    return this.overlays()
      .map((o) => o.id)
      .filter((id) => this.enabled.has(id));
  }

  isEnabled(id: string): boolean {
    return this.enabled.has(id);
  }

  /** `true` when the id was known -- an unknown id is ignored, never
   * thrown on, so a stale `?debug=` in somebody's bookmark can never stop
   * the game from booting. */
  enable(id: string): boolean {
    if (!this.byId.has(id)) return false;
    this.enabled.add(id);
    return true;
  }

  disable(id: string): boolean {
    if (!this.byId.has(id)) return false;
    this.enabled.delete(id);
    return true;
  }

  toggle(id: string): boolean {
    if (!this.byId.has(id)) return false;
    if (this.enabled.has(id)) this.enabled.delete(id);
    else this.enabled.add(id);
    return true;
  }
}
