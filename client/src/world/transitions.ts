// The client's own TypeScript mirror of `sim::world::World`'s floor
// transitions (Tim's direction, story 1.7): keyed by anchor cell, entering
// one changes the player's floor and collision set in a single step --
// there must never be a state where the floor has changed but the
// collision set has not. `world/**` rules apply: no `pixi.js`, no DOM.
//
// `CollisionGrid` already indexes every floor's colliders together, keyed
// by `floor` on every query (`entriesInCell(floor, x, y)`) rather than one
// grid swapped out per floor -- so "the collision set changes in the same
// step" is a property of a caller reading `transitionAt`'s target position
// and floor from one call and applying both fields as a single assignment,
// never a `floor` update followed by a separate position update a caller
// could observe half-done. `world/floor-walk.ts`'s `stepAndTransition` is
// that caller -- gating the lookup on a real cell change is what actually
// makes a transition edge-triggered (entered by walking), never level-
// triggered on every tick a key is held; this module only holds the data.

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

  /** Throws if two specs share the same anchor cell -- `sim::world::
   * WorldSpec::build` itself does not check this today (a plain
   * `BTreeMap::insert` silently keeps only the last one), but silently
   * dropping one of two transitions a generator declared at the same
   * anchor is exactly the class of bug this story found the hard way
   * (two transitions landing on each other's own anchor, discovered only
   * by a real keyboard walk bouncing between floors); the client refuses
   * it outright rather than picking a winner nobody chose. */
  constructor(transitions: readonly TransitionSpec[]) {
    const map = new Map<string, TransitionTarget>();
    for (const t of transitions) {
      const k = key(t.x, t.y, t.floor);
      if (map.has(k)) {
        throw new Error(
          `TransitionIndex: duplicate transition anchor (${t.x}, ${t.y}, floor ${t.floor})`,
        );
      }
      map.set(k, { x: t.targetX, y: t.targetY, floor: t.targetFloor });
    }
    this.byAnchor = map;
  }

  /** The floor transition anchored at this cell, if any (FR117).
   * `undefined` if `(x, y, floor)` is not a transition's anchor. */
  transitionAt(x: number, y: number, floor: number): TransitionTarget | undefined {
    return this.byAnchor.get(key(x, y, floor));
  }
}
