// The sort-order overlay's drawing half (story 1.12, AC3): two lines of
// `<text>` per record `sort-labels.ts` already built -- the FR123 key,
// and the order index the renderer actually resolved.
//
// `paint-order: stroke` plus a halo stroke is what keeps a readout legible
// over any sprite beneath it without a backing panel; an overlay that
// needed an opaque box behind every label would hide the very overlap it
// exists to explain.

import { DEBUG_STYLE } from "./debug-style";
import type { DebugOverlay } from "./overlay-registry";
import { buildSortLabels } from "./sort-labels";
import { svgElement } from "./svg";
import type { DebugWorldView } from "./world-view";

export const sortOverlay: DebugOverlay = {
  id: "sort",
  label: "Sort keys and resolved order (FR123)",
  draw(group: SVGGElement, view: DebugWorldView): void {
    const doc = group.ownerDocument;
    for (const label of buildSortLabels(view)) {
      const text = svgElement(doc, "text", {
        "data-bc-sort-label": label.stableId.toString(),
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
      // Drawn upward from the anchor, so a readout never covers the cell
      // below the drawable it belongs to.
      text.appendChild(
        svgElement(doc, "tspan", {
          x: label.x,
          y: label.y - DEBUG_STYLE.lineHeightPx,
        }),
      ).textContent = label.label;
      text.appendChild(
        svgElement(doc, "tspan", {
          x: label.x,
          y: label.y,
        }),
      ).textContent = label.orderLabel;
      group.appendChild(text);
    }
  },
};
