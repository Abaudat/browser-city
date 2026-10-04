// The L3 overlay's drawing half (story 5.1): the readouts `l3-labels.ts`
// built, in the shared debug style. Nothing is added to the production screen.

import { DEBUG_STYLE } from "./debug-style";
import { buildL3Labels } from "./l3-labels";
import type { DebugOverlay } from "./overlay-registry";
import { svgElement } from "./svg";
import type { DebugWorldView } from "./world-view";

export const l3Overlay: DebugOverlay = {
  id: "l3",
  label: "L3 bodies: straight-line fallbacks and out-of-band pace (FR64)",
  draw(group: SVGGElement, view: DebugWorldView): void {
    const doc = group.ownerDocument;
    for (const label of buildL3Labels(view)) {
      const text = svgElement(doc, "text", {
        "data-bc-l3-label": label.id,
        x: label.x,
        y: label.y,
        "text-anchor": "middle",
        "font-family": DEBUG_STYLE.fontFamily,
        "font-size": DEBUG_STYLE.fontSizePx,
        fill: label.fill,
        stroke: DEBUG_STYLE.palette.labelHalo,
        "stroke-width": DEBUG_STYLE.strokeWidthPx,
        "vector-effect": "non-scaling-stroke",
        "paint-order": "stroke",
      });
      text.textContent = label.text;
      group.appendChild(text);
    }
  },
};
