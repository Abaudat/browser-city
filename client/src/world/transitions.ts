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

/** One of the four axis-aligned unit steps a transition pair's own offset
 * must be -- never a diagonal, never zero. */
const UNIT_AXIS_STEPS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Whether a whole cell can be stood on, on its own floor, for the real
 * player body -- the same shape `world/world-spec.ts`'s own
 * `WorldSpecCheck.isStandable` takes, so a caller already holding one
 * (`CollisionGridQuery` plus `defs/balance/movement.toml`'s body) never
 * builds a second. */
export type TransitionStandable = (x: number, y: number, floor: number) => boolean;

/**
 * Whether `reverse` is `forward`'s own mirror (story 15.2, Quentin's
 * direction): a floor transition is a physical thing (a stairwell, a
 * ladder) walked in both directions, and a pair that is not laid out as an
 * honest mirror of itself is exactly the class of defect this checks for
 * -- the subway stairs' own up-anchor sitting one cell off the wrong axis
 * from its landing, discovered only by a keyboard walk that could climb
 * back up by no direction a player would ever guess.
 *
 * The shape checked, for some axis-aligned unit step `d`:
 * `reverse.anchor === forward.landing - d` (the reverse transition's own
 * anchor is the forward one's landing cell, offset one cell along the
 * shared axis) and `reverse.landing === forward.anchor - d` (its landing
 * is the forward anchor's own neighbour, offset by that same `d`) -- the
 * same `d` in both, which is what makes stepping through `forward` then
 * immediately back through `reverse` (holding one direction, then its
 * opposite) return a walker to the exact cell it started the pair from,
 * proven as `inv_transition_pairs_round_trip` in `transitions.test.ts`.
 */
function isMirroredPair(forward: TransitionSpec, reverse: TransitionSpec): boolean {
  if (reverse.floor !== forward.targetFloor || reverse.targetFloor !== forward.floor) {
    return false;
  }
  return UNIT_AXIS_STEPS.some(
    (d) =>
      reverse.x === forward.targetX - d.x &&
      reverse.y === forward.targetY - d.y &&
      reverse.targetX === forward.x - d.x &&
      reverse.targetY === forward.y - d.y,
  );
}

/**
 * Every problem with `transitions`' own pair symmetry, as a list (empty
 * means every transition mirrors a real reverse) -- `checkWorldSpec`'s own
 * idiom, so a caller sees everything wrong at once rather than only the
 * first. Two halves per transition: it must pair with some other entry in
 * the same list the way [`isMirroredPair`] describes, and both cells the
 * *pair* introduces (the reverse's own anchor and landing) must be
 * standable for the real body `isStandable` was built from -- the forward
 * transition's own anchor/landing are `world/world-spec.ts`'s job, not
 * repeated here.
 */
export function checkTransitionPairSymmetry(
  transitions: readonly TransitionSpec[],
  isStandable: TransitionStandable,
): string[] {
  const problems: string[] = [];
  for (const forward of transitions) {
    const where = `transition (${forward.x}, ${forward.y}, floor ${forward.floor}) -> (${forward.targetX}, ${forward.targetY}, floor ${forward.targetFloor})`;
    const reverse = transitions.find(
      (candidate) => candidate !== forward && isMirroredPair(forward, candidate),
    );
    if (!reverse) {
      problems.push(`${where} has no mirrored reverse transition in the same list`);
      continue;
    }
    if (!isStandable(reverse.x, reverse.y, reverse.floor)) {
      problems.push(
        `${where}'s own reverse anchor (${reverse.x}, ${reverse.y}, floor ${reverse.floor}) is not standable`,
      );
    }
    if (!isStandable(reverse.targetX, reverse.targetY, reverse.targetFloor)) {
      problems.push(
        `${where}'s own reverse landing (${reverse.targetX}, ${reverse.targetY}, floor ${reverse.targetFloor}) is not standable`,
      );
    }
  }
  return problems;
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
   * it outright rather than picking a winner nobody chose.
   *
   * `pairSymmetry`, when supplied (story 15.2, Quentin's direction), also
   * runs [`checkTransitionPairSymmetry`] and throws naming every problem
   * found -- opt-in, not the default, because `world/floor-walk.test.ts`'s
   * own "mutually-targeting pair" cases deliberately construct the exact
   * shape `sim::world::WorldSpec::build` itself does not reject (two
   * transitions targeting each other's own identical anchor cell) to
   * prove `stepAndTransition`'s edge-triggered gating alone never bounces
   * on it -- that fixture must keep constructing cleanly. Real world data
   * (`test-street/fixture.ts`'s committed street) opts in. */
  constructor(
    transitions: readonly TransitionSpec[],
    pairSymmetry?: { readonly isStandable: TransitionStandable },
  ) {
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

    if (pairSymmetry) {
      const problems = checkTransitionPairSymmetry(transitions, pairSymmetry.isStandable);
      if (problems.length > 0) {
        throw new Error(
          `TransitionIndex: transition pair symmetry violated:\n${problems.join("\n")}`,
        );
      }
    }
  }

  /** The floor transition anchored at this cell, if any (FR117).
   * `undefined` if `(x, y, floor)` is not a transition's anchor. */
  transitionAt(x: number, y: number, floor: number): TransitionTarget | undefined {
    return this.byAnchor.get(key(x, y, floor));
  }
}
