// Story 1.1's ping indicator. Plain DOM, not Pixi (Tim's direction, story
// 1.13): the page has exactly one Pixi `Application` -- the street
// scene's -- and one render loop, which is what the NFR2 frame-work gate
// actually measures. A `<div>` that changes colour costs nothing on that
// budget and needs no canvas, no GPU context and no ticker of its own.

import type { PingObservation } from "../net/observe-ping";

export interface Renderer {
  showPing(observation: PingObservation): void;
}

// Cycles through a fixed palette keyed on the row id, so a second write is
// visibly a second write rather than a redraw of the first.
const PALETTE = [0xff6b6b, 0x4dabf7, 0x69db7c, 0xffd43b, 0xda77f2];

function toCssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * Mounts one small, fixed-position dot into `mountEl` and returns a
 * handle to recolour it on every ping. Synchronous: there is no longer
 * anything here to `await`.
 */
export function bootstrapRenderer(mountEl: HTMLElement): Renderer {
  const dot = document.createElement("div");
  // A stable, purpose-specific id: the street's own visual-regression
  // checks (`test-street.spec.ts`) mask this element by selector, since
  // it sits at a fixed viewport position that can overlap the street
  // canvas and recolours on a ping this scene has no other control over.
  dot.id = "bc-ping-indicator";
  dot.style.cssText =
    "position:fixed;top:12px;left:12px;width:24px;height:24px;border-radius:50%;" +
    "background:#101018;pointer-events:none;z-index:1000;";
  mountEl.appendChild(dot);

  function showPing(observation: PingObservation): void {
    const color = PALETTE[Number(observation.id % BigInt(PALETTE.length))] ?? 0xffffff;
    dot.style.background = toCssColor(color);
  }

  return { showPing };
}
