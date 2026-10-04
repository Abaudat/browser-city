// Keyboard state as its own small module: `world/**` is the pure
// movement/collision layer and may not touch the DOM, so the one place
// that binds `window` events lives here instead. `KeyboardState` tracks
// which movement keys are held and reduces them to one input direction;
// `attachKeyboard` is the only function here that touches `window`.
//
// Which physical key drives which action is `input/keybindings.ts`'s
// data, not a table here (FR149): there is no hard-coded key map left in
// this file, so a rebind is a change of state, never a change of code.

import type { BindableAction, Bindings, Direction } from "./keybindings";
import { ACTION_DIRECTIONS, actionForCode } from "./keybindings";

export type { Direction } from "./keybindings";

/** Which movement actions are currently held -- `keydown`/`keyup` resolve
 * a `KeyboardEvent.code` through the current bindings and add or remove
 * the *action*, never the key. Holding a key while it is rebound
 * therefore cannot leave a stale code stuck down.
 *
 * `releaseAll` (window `blur`/`visibilitychange`) is the one place every
 * action is dropped at once, so a key released while the tab is hidden --
 * never delivering its own `keyup` -- cannot leave the player walking
 * forever into a wall. */
export class KeyboardState {
  private readonly held = new Set<BindableAction>();
  private suspended = false;

  constructor(private bindings: Bindings) {}

  /** Swaps in a new map (a rebind, or a reset to defaults) and releases
   * everything currently held: the codes that were down belong to the map
   * that is going away. */
  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
    this.releaseAll();
  }

  /** The options menu (FR151) takes the keyboard while it is open
   * (Artie's direction), so movement keys pressed there never also walk
   * the avatar. Releases whatever was held, so opening the menu
   * mid-stride never leaves a direction stuck. */
  suspend(): void {
    this.suspended = true;
    this.releaseAll();
  }

  resume(): void {
    this.suspended = false;
    this.releaseAll();
  }

  keydown(code: string): void {
    if (this.suspended) return;
    const action = actionForCode(this.bindings, code);
    if (action) this.held.add(action);
  }

  keyup(code: string): void {
    const action = actionForCode(this.bindings, code);
    if (action) this.held.delete(action);
  }

  releaseAll(): void {
    this.held.clear();
  }

  /** The combined input direction of every held action, not normalised --
   * `world/movement.ts`'s `step` normalises it. Opposite actions held
   * together cancel to `(0, 0)`, a true no-op. */
  direction(): Direction {
    let x = 0;
    let y = 0;
    for (const action of this.held) {
      const delta = ACTION_DIRECTIONS[action];
      x += delta.x;
      y += delta.y;
    }
    return { x, y };
  }
}

/**
 * Wires a `KeyboardState` to real DOM events -- the only function in this
 * module that touches `window`. Reads `event.code` (the physical key),
 * never `event.key`: `.key` is "W" the moment Shift or CapsLock is down
 * and "z" on an AZERTY layout, either of which silently stops movement.
 *
 * Releasing every key on `blur` and `visibilitychange` (never just
 * `keyup`) is what keeps a backgrounded or defocused tab from leaving a
 * direction stuck held. Returns a cleanup function that removes every
 * listener it added.
 */
export function attachKeyboard(state: KeyboardState, target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent): void => state.keydown(event.code);
  const onKeyUp = (event: KeyboardEvent): void => state.keyup(event.code);
  const onReleaseAll = (): void => state.releaseAll();

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onReleaseAll);
  target.document?.addEventListener("visibilitychange", onReleaseAll);

  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("blur", onReleaseAll);
    target.document?.removeEventListener("visibilitychange", onReleaseAll);
  };
}
