// The L3 overlay's pure half (story 5.1): one readout per live L3 body on
// the viewer's floor -- whether it is walking straight through the world for
// want of a path, and whether a segment of its leg is walked outside the
// walking-pace band. Both are defects in whoever issued the leg; the body
// still arrives on time, so without this they would be silent.

import { worldPointPx } from "../render/screen-position";
import { DEBUG_STYLE } from "./debug-style";
import type { DebugWorldView } from "./world-view";

export interface L3Label {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fill: string;
}

export function buildL3Labels(view: DebugWorldView): L3Label[] {
  const floor = view.viewerFloor();
  const labels: L3Label[] = [];
  for (const body of view.l3Bodies()) {
    if (body.floor !== floor) continue;
    const defects: string[] = [];
    if (body.fallbacks > 0) defects.push(`straight x${body.fallbacks}`);
    if (body.paceOutOfBand) defects.push("pace");
    const anchor = worldPointPx(
      body.x,
      body.y,
      body.floor,
      view.tileSizePx,
      view.storeyHeightPx,
      view.zoom,
      0,
    );
    labels.push({
      id: body.id,
      text: `${body.id} ${defects.length === 0 ? "ok" : defects.join(" ")}`,
      x: anchor.x,
      y: anchor.y,
      fill: defects.length === 0 ? DEBUG_STYLE.palette.sortLabel : DEBUG_STYLE.palette.playerBody,
    });
  }
  return labels;
}
