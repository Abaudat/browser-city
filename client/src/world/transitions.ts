// The client's own TypeScript mirror of `sim::world::World`'s floor
// transitions (Tim's direction, story 1.7): keyed by anchor cell, entering
// one changes the player's floor and collision set in a single step --
// there must never be a state where the floor has changed but the
// collision set has not. `world/**` rules apply: no `pixi.js`, no DOM.
//
// `CollisionGrid` already indexes every floor's colliders together, keyed
// by `floor` on every query (`entriesInCell(floor, x, y)`) rather than one
// grid swapped out per floor -- so "the collision set changes in the same
// step" is a property of [`TransitionIndex.enter`] returning the new
// `floor` and position together, from one call, for the caller to apply
// as a single assignment, never a `floor` update followed by a separate
// position update a caller could observe half-done.

/** One floor transition's anchor and target (FR117) -- mirrors
 * `sim::world::TransitionSpec`'s columns. A door is never one of these
 * (FR118): it is an ordinary walkable cell this index has no entry for. */
export interface TransitionSpec {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetFloor: number;
}

/** The position and floor a transition lands the entity at, from one
 * function application. */
export interface TransitionTarget {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

function key(x: number, y: number, floor: number): string {
  return `${x}|${y}|${floor}`;
}

/** Transitions keyed by anchor cell (FR117), mirroring
 * `sim::world::World`'s own `transitions: BTreeMap<(i32, i32, i8),
 * Transition>`. */
export class TransitionIndex {
  private readonly byAnchor: ReadonlyMap<string, TransitionTarget>;

  constructor(transitions: readonly TransitionSpec[]) {
    const map = new Map<string, TransitionTarget>();
    for (const t of transitions) {
      map.set(key(t.x, t.y, t.floor), { x: t.targetX, y: t.targetY, floor: t.targetFloor });
    }
    this.byAnchor = map;
  }

  /** The floor transition anchored at this cell, if any (FR117). */
  transitionAt(x: number, y: number, floor: number): TransitionTarget | undefined {
    return this.byAnchor.get(key(x, y, floor));
  }

  /** Entering a transition cell (FR117): the target position and floor
   * from one call -- a caller applies both fields in a single assignment,
   * so there is no intermediate render or collision query that could ever
   * see the new floor with the old position, or vice versa. `undefined`
   * if `(x, y, floor)` is not a transition's anchor. */
  enter(x: number, y: number, floor: number): TransitionTarget | undefined {
    return this.transitionAt(x, y, floor);
  }
}
