// Keyboard state as its own small module: `world/**` is the pure
// movement/collision layer and may not touch the DOM, so the one place
// that binds `window` events lives here instead. `KeyboardState` tracks
// which movement keys are held and reduces them to one input direction;
// `attachKeyboard` is the only function here that touches `window`.

export type DirectionKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "w"
  | "a"
  | "s"
  | "d";

const KEY_TO_DELTA: Readonly<Record<DirectionKey, readonly [number, number]>> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

function isDirectionKey(key: string): key is DirectionKey {
  return key in KEY_TO_DELTA;
}

export interface Direction {
  readonly x: number;
  readonly y: number;
}

/** Which movement keys are currently held -- `keydown`/`keyup` add and
 * remove one key each; `releaseAll` (window `blur`/`visibilitychange`) is
 * the one place every key is dropped at once, so a key released while the
 * tab is hidden (never delivering its own `keyup`) cannot leave the
 * player walking forever into a wall. */
export class KeyboardState {
  private readonly pressed = new Set<DirectionKey>();

  keydown(key: string): void {
    if (isDirectionKey(key)) this.pressed.add(key);
  }

  keyup(key: string): void {
    if (isDirectionKey(key)) this.pressed.delete(key);
  }

  releaseAll(): void {
    this.pressed.clear();
  }

  /** The combined input direction of every held key, not normalised --
   * `world/movement.ts`'s `step` normalises it. Opposite keys held
   * together (e.g. `ArrowLeft` and `ArrowRight`) cancel to `(0, 0)`, a
   * true no-op. */
  direction(): Direction {
    let x = 0;
    let y = 0;
    for (const key of this.pressed) {
      const [dx, dy] = KEY_TO_DELTA[key];
      x += dx;
      y += dy;
    }
    return { x, y };
  }
}

/**
 * Wires a `KeyboardState` to real DOM events -- the only function in this
 * module that touches `window`. Releasing every key on `blur` and
 * `visibilitychange` (never just `keyup`) is what keeps a backgrounded or
 * defocused tab from leaving a direction stuck held. Returns a cleanup
 * function that removes every listener it added.
 */
export function attachKeyboard(state: KeyboardState, target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent): void => state.keydown(event.key);
  const onKeyUp = (event: KeyboardEvent): void => state.keyup(event.key);
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
