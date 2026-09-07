// Rendering only. Never imports from `net/bindings` (Tim, story 1.1) --
// this module takes the plain `PingObservation` shape `net/observe-ping.ts`
// already produced and knows nothing about the SDK or the wire format.

import { Application, Graphics } from "pixi.js";
import type { PingObservation } from "../net/observe-ping";

export interface Renderer {
  readonly app: Application;
  showPing(observation: PingObservation): void;
}

// Cycles through a fixed palette keyed on the row id, so a second write is
// visibly a second write rather than a redraw of the first.
const PALETTE = [0xff6b6b, 0x4dabf7, 0x69db7c, 0xffd43b, 0xda77f2];

/**
 * Initialises PixiJS with WebGPU preferred and WebGL fallback (the
 * architecture's rendering row, proven here on day one rather than on the
 * day the tilemap lands) and mounts one canvas into `mountEl`.
 */
export async function bootstrapRenderer(mountEl: HTMLElement): Promise<Renderer> {
  const app = new Application();
  await app.init({
    preference: "webgpu",
    background: "#101018",
    resizeTo: window,
  });
  mountEl.appendChild(app.canvas);

  const dot = new Graphics();
  app.stage.addChild(dot);

  function showPing(observation: PingObservation): void {
    const color = PALETTE[Number(observation.id % BigInt(PALETTE.length))] ?? 0xffffff;
    dot.clear();
    dot.circle(app.screen.width / 2, app.screen.height / 2, 24).fill({ color });
  }

  return { app, showPing };
}
