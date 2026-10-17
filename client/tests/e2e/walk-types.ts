// The vocabulary of a scripted walk, shared by the e2e walk helper
// (`walk-support.ts`), its in-page watcher (`walk-watcher.ts`) and the unit
// tests that drive both against the real resolver. A walk is a list of
// segments: hold a key until a condition holds. Nothing here knows a
// coordinate of any world.

import { bodyCell, MAX_DELTA_MS } from "../../src/world/movement";

/** One held movement key, in the same `KeyboardEvent.code`-shaped names
 * the default bindings use -- never a raw direction vector, because the
 * e2e walk must go through the real keybindings, not around them. */
export type WalkKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** When to let a held key go. Declarative on purpose: the same value is
 * evaluated in node (against a simulated step) and inside the page
 * (against `window.__bc.playerPosition`/`playerFloor`), so neither side
 * needs a fixed wait. */
export type WalkUntil =
  | { readonly kind: "x-at-least"; readonly value: number }
  | { readonly kind: "x-at-most"; readonly value: number }
  | { readonly kind: "y-at-least"; readonly value: number }
  | { readonly kind: "y-at-most"; readonly value: number }
  | { readonly kind: "floor"; readonly value: number }
  /** Arrival at a specific cell: what a player just walking normally would
   * notice. Never as precise as a real collider rest. */
  | { readonly kind: "cell"; readonly x: number; readonly y: number };

export interface WalkSegment {
  /** The checkpoint this segment ends at -- what a spec asserts against by
   * name, so a reordered route can never silently assert the wrong thing. */
  readonly label: string;
  readonly key: WalkKey;
  readonly until: WalkUntil;
}

/** The most a scripted walk may rest past its release condition: the tick
 * that crossed it plus `releaseLagSteps` more, each at the resolver's own
 * delta clamp. The e2e walk helper fails any axis-threshold segment that
 * rests further past its threshold. */
export const RELEASE_LAG = { stepMs: MAX_DELTA_MS, releaseLagSteps: 1 } as const;

/** Whether a held key's own release condition is met, for a walker at
 * `(x, y)` on `floor`. The one rule both the simulated and the real walk
 * use. */
export function walkUntilMet(until: WalkUntil, x: number, y: number, floor: number): boolean {
  switch (until.kind) {
    case "x-at-least":
      return x >= until.value;
    case "x-at-most":
      return x <= until.value;
    case "y-at-least":
      return y >= until.value;
    case "y-at-most":
      return y <= until.value;
    case "floor":
      return floor === until.value;
    case "cell": {
      const cell = bodyCell({ x, y });
      return cell.x === until.x && cell.y === until.y;
    }
  }
}

/** The direction a held key walks in -- the same mapping the default
 * keybindings produce, restated here only so a *simulated* walk can run
 * without a DOM (`input/keyboard.ts` needs real key events). */
export const WALK_DIRECTIONS: Readonly<Record<WalkKey, { x: number; y: number }>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};
