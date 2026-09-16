// The collision overlay's drawing half (story 1.12, AC2): one element per
// record `collision-rects.ts` already decided. It branches on `kind`
// only to pick a *shape* -- every colour, every width and the whole
// three-state distinction were settled in the pure builder, so there is
// no rule here a test could fail to see.
//
// `data-bc-collider` carries the kind onto the element itself, which is
// what lets `client/tests/e2e/debug-overlays.spec.ts` assert AC2 against
// the real, mounted page by selector rather than by pixel diff.

import { buildCollisionRects } from "./collision-rects";
import { DEBUG_STYLE } from "./debug-style";
import type { DebugOverlay } from "./overlay-registry";
import { svgElement } from "./svg";
import type { DebugWorldView } from "./world-view";

/** How long each arm of the cross marking a zero-area collider is, in
 * world pixels -- a mark for something with no extent has to have an
 * extent of its own, or it would be drawn as literally nothing. */
const EMPTY_MARK_PX = 3;

export const collisionOverlay: DebugOverlay = {
  id: "collision",
  label: "Collision footprints (FR128)",
  draw(group: SVGGElement, view: DebugWorldView): void {
    const doc = group.ownerDocument;
    for (const rect of buildCollisionRects(view)) {
      const common = {
        "data-bc-collider": rect.kind,
        "data-bc-object": rect.objectId.toString(),
        stroke: rect.stroke,
        "stroke-width": DEBUG_STYLE.strokeWidthPx,
        "vector-effect": "non-scaling-stroke",
      };

      if (rect.kind === "empty") {
        // A cross at the declared origin: there is no area to outline,
        // and a zero-size rect would draw nothing at all.
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const mark = svgElement(doc, "path", {
          ...common,
          fill: "none",
          d: `M${cx - EMPTY_MARK_PX} ${cy}H${cx + EMPTY_MARK_PX}M${cx} ${cy - EMPTY_MARK_PX}V${cy + EMPTY_MARK_PX}`,
        });
        group.appendChild(mark);
        continue;
      }

      group.appendChild(
        svgElement(doc, "rect", {
          ...common,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          fill: rect.fill,
          ...(rect.fill === "none" ? {} : { "fill-opacity": DEBUG_STYLE.fillOpacity }),
          ...(rect.dashArray ? { "stroke-dasharray": rect.dashArray } : {}),
        }),
      );
    }
  },
};
