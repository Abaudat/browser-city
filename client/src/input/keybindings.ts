// FR149's keybindings, as pure data and pure functions. No DOM, no
// storage, no `window` -- `input/keybindings-storage.ts` is the only
// thing that persists any of this, and `input/keyboard.ts` the only thing
// that resolves a real key event against it.
//
// Bindings are keyed on `KeyboardEvent.code` -- the physical key --
// never on `.key`. `.key` is the character the layout produces, so it is
// "z" on AZERTY where it is "w" on QWERTY, and it becomes "W" the moment
// Shift or CapsLock is down, which silently stops movement mid-walk.
// `.code` is "KeyW" in all four cases.

export type BindableAction = "move_up" | "move_down" | "move_left" | "move_right";

/** Canonical order: what the options menu lists, and the order conflicts
 * are resolved in when hostile stored data binds one code twice. */
export const BINDABLE_ACTIONS: readonly BindableAction[] = [
  "move_up",
  "move_down",
  "move_left",
  "move_right",
];

export type Bindings = Readonly<Record<BindableAction, readonly string[]>>;

/** One combined input direction, in world axes -- not normalised;
 * `world/movement.ts`'s `step` does that. */
export interface Direction {
  readonly x: number;
  readonly y: number;
}

/** Codes no action may ever take. `Escape` opens and closes the options
 * menu (FR151) -- a player who bound it to "walk left" could not reach
 * the menu to undo it. */
export const RESERVED_CODES: readonly string[] = ["Escape"];

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.includes(code);
}

/** WASD plus the arrow keys (FR149), each action carrying both. */
export const DEFAULT_BINDINGS: Bindings = Object.freeze({
  move_up: Object.freeze(["KeyW", "ArrowUp"]),
  move_down: Object.freeze(["KeyS", "ArrowDown"]),
  move_left: Object.freeze(["KeyA", "ArrowLeft"]),
  move_right: Object.freeze(["KeyD", "ArrowRight"]),
});

/** The one input direction each action contributes, in world axes: y
 * grows south, so "up" is negative. */
export const ACTION_DIRECTIONS: Readonly<
  Record<BindableAction, { readonly x: number; readonly y: number }>
> = Object.freeze({
  move_up: Object.freeze({ x: 0, y: -1 }),
  move_down: Object.freeze({ x: 0, y: 1 }),
  move_left: Object.freeze({ x: -1, y: 0 }),
  move_right: Object.freeze({ x: 1, y: 0 }),
});

/** Which action a physical key code drives, or `undefined` if it drives
 * none. One code is bound to at most one action by construction -- see
 * [`rebind`] and [`normaliseBindings`], both of which maintain that. */
export function actionForCode(bindings: Bindings, code: string): BindableAction | undefined {
  for (const action of BINDABLE_ACTIONS) {
    if (bindings[action].includes(code)) return action;
  }
  return undefined;
}

function withAction(
  bindings: Bindings,
  action: BindableAction,
  codes: readonly string[],
): Bindings {
  return { ...bindings, [action]: codes };
}

/**
 * Binds `code` to `action`'s slot `slotIndex`, returning a new map --
 * never mutating the one given.
 *
 * If another action already had `code`, the two *swap*: that action takes
 * the code this slot is giving up (Artie's direction -- never an error
 * dialog, and never an action silently left with one key fewer). Either
 * way the result is injective: a code drives exactly one action.
 *
 * A reserved code is refused outright and the map comes back untouched.
 */
export function rebind(
  bindings: Bindings,
  action: BindableAction,
  slotIndex: number,
  code: string,
): Bindings {
  if (isReservedCode(code)) return bindings;

  const current = [...bindings[action]];
  const displaced = current[slotIndex];
  if (displaced === code) return bindings;

  const previousOwner = actionForCode(bindings, code);

  if (slotIndex < current.length) current[slotIndex] = code;
  else current.push(code);

  if (previousOwner === action) {
    // The code was already this action's, in another slot: move it,
    // never duplicate it. The slot it came from takes what was displaced
    // (or simply loses it, if this slot was empty).
    const moved = current.map((c, i) => {
      if (i === slotIndex) return c;
      return c === code ? displaced : c;
    });
    return withAction(
      bindings,
      action,
      moved.filter((c): c is string => c !== undefined),
    );
  }

  let next = withAction(bindings, action, current);
  if (previousOwner) {
    const theirs = next[previousOwner].map((c) => (c === code ? displaced : c));
    next = withAction(
      next,
      previousOwner,
      theirs.filter((c): c is string => c !== undefined),
    );
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns anything at all -- a parsed storage blob, a hand-edited one, a
 * number, `undefined` -- into a complete, valid, injective binding map.
 * Never throws (`inv_keybindings_parse_is_total`): a player whose stored
 * bindings are nonsense gets the defaults and a working game, not a blank
 * screen.
 *
 * Merged *per action* over the defaults (Tim's direction), so an action
 * added in a later build does not wipe what a player already set, and an
 * action whose stored list cleans away to nothing falls back to its own
 * defaults rather than leaving that direction unplayable.
 */
export function normaliseBindings(value: unknown): Bindings {
  if (!isRecord(value)) return DEFAULT_BINDINGS;

  const claimed = new Set<string>();
  const result: Record<BindableAction, readonly string[]> = {
    ...(DEFAULT_BINDINGS as Record<BindableAction, readonly string[]>),
  };

  // Two passes in canonical order: clean each action's own list first,
  // then resolve any code two actions both claim in favour of the first.
  const cleaned = new Map<BindableAction, string[]>();
  for (const action of BINDABLE_ACTIONS) {
    const stored = value[action];
    if (!Array.isArray(stored)) continue;
    const codes: string[] = [];
    for (const code of stored) {
      if (typeof code !== "string" || code.length === 0) continue;
      if (isReservedCode(code)) continue;
      if (!codes.includes(code)) codes.push(code);
    }
    cleaned.set(action, codes);
  }

  for (const action of BINDABLE_ACTIONS) {
    const codes = cleaned.get(action) ?? [...DEFAULT_BINDINGS[action]];
    const kept = (codes.length > 0 ? codes : [...DEFAULT_BINDINGS[action]]).filter(
      (code) => !claimed.has(code),
    );
    for (const code of kept) claimed.add(code);
    result[action] = kept;
  }

  return result;
}
