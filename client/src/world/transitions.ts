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

export interface UnitStep {
  readonly x: number;
  readonly y: number;
}

/** One of the four axis-aligned unit steps a transition pair's own offset
 * must be -- never a diagonal, never zero. */
const UNIT_AXIS_STEPS: readonly UnitStep[] = [
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
 * Whether `reverse` is `forward`'s own mirror for axis-aligned unit step
 * `d` (story 15.2, Quentin's direction): a floor transition is a physical
 * thing (a stairwell, a ladder) walked in both directions, and a pair that
 * is not laid out as an honest mirror of itself is exactly the class of
 * defect this checks for -- the subway stairs' own up-anchor sitting one
 * cell off the wrong axis from its landing, discovered only by a keyboard
 * walk that could climb back up by no direction a player would ever guess.
 *
 * The shape: `reverse.anchor === forward.landing - d` (the reverse
 * transition's own anchor is the forward one's landing cell, offset one
 * cell along the shared axis) and `reverse.landing === forward.anchor - d`
 * (its landing is the forward anchor's own neighbour, offset by that same
 * `d`) -- the same `d` in both, which is what makes stepping through
 * `forward` then immediately back through `reverse` (holding one
 * direction, then its opposite) return a walker to the exact cell it
 * started the pair from, proven as `inv_transition_pairs_round_trip` in
 * `transitions.test.ts`.
 */
function mirrorsFor(forward: TransitionSpec, reverse: TransitionSpec, d: UnitStep): boolean {
  if (reverse.floor !== forward.targetFloor || reverse.targetFloor !== forward.floor) {
    return false;
  }
  return (
    reverse.x === forward.targetX - d.x &&
    reverse.y === forward.targetY - d.y &&
    reverse.targetX === forward.x - d.x &&
    reverse.targetY === forward.y - d.y
  );
}

/** Finds the axis-aligned unit step `d` that makes `reverse` mirror
 * `forward` (see [`mirrorsFor`]), or `undefined` if none of the four does. */
function findMirrorAxis(forward: TransitionSpec, reverse: TransitionSpec): UnitStep | undefined {
  return UNIT_AXIS_STEPS.find((d) => mirrorsFor(forward, reverse, d));
}

/** One matched transition pair, plus the axis-aligned unit step `d` they
 * mirror on -- exposed so a caller (`street-conformance.test.ts`'s own
 * "one entrance" geometry check) never has to re-derive which side of
 * each anchor is the entry side: it is `anchor - d` for `forward`
 * (approached by walking `+d`) and `reverse.anchor + d` for `reverse`
 * (approached by walking `-d`, which is exactly `forward.landing`) --
 * [`forwardOpenNeighbor`]/[`reverseOpenNeighbor`] below compute these. */
export interface TransitionPairing {
  readonly forward: TransitionSpec;
  readonly reverse: TransitionSpec;
  readonly d: UnitStep;
}

/**
 * Pairs every transition with its own mirrored reverse, one to one (story
 * 15.2, Quentin's direction, finding 6): a plain `Array.find` lets two
 * different forwards both claim the same reverse when three or more
 * transitions are in play, which is not a real pairing at all. Each
 * transition is claimed by at most one pairing, as either its `forward` or
 * its `reverse` -- once claimed, it can never be reused. Greedy, in list
 * order: real fixtures pair into small, disjoint groups (the subway pair,
 * the footbridge pair), never a general matching problem that needs
 * backtracking.
 */
export function pairTransitions(transitions: readonly TransitionSpec[]): {
  readonly pairings: readonly TransitionPairing[];
  readonly unpaired: readonly TransitionSpec[];
} {
  const claimed = new Set<TransitionSpec>();
  const pairings: TransitionPairing[] = [];
  const unpaired: TransitionSpec[] = [];
  for (const forward of transitions) {
    if (claimed.has(forward)) continue;
    let match: { readonly reverse: TransitionSpec; readonly d: UnitStep } | undefined;
    for (const candidate of transitions) {
      if (candidate === forward || claimed.has(candidate)) continue;
      const d = findMirrorAxis(forward, candidate);
      if (d) {
        match = { reverse: candidate, d };
        break;
      }
    }
    if (match) {
      claimed.add(forward);
      claimed.add(match.reverse);
      pairings.push({ forward, reverse: match.reverse, d: match.d });
    } else {
      unpaired.push(forward);
    }
  }
  return { pairings, unpaired };
}

/** `forward`'s own entry side (story 15.2): the neighbour cell, on
 * `forward`'s own floor, that must be the only walkable approach to
 * `forward.anchor` -- reached by walking `d`. A stairwell has one top and
 * one bottom: every *other* neighbour of the anchor must refuse a step
 * into it (`street-conformance.test.ts`'s own "one entrance" geometry
 * check), which this pairing's `d` is what tells a caller which neighbour
 * that is, rather than each caller re-deriving it from the street's own
 * layout. */
export function forwardOpenNeighbor(pairing: TransitionPairing): {
  readonly cell: { readonly x: number; readonly y: number };
  readonly direction: UnitStep;
} {
  const { forward, d } = pairing;
  return { cell: { x: forward.x - d.x, y: forward.y - d.y }, direction: d };
}

/** `reverse`'s own entry side -- symmetric to [`forwardOpenNeighbor`],
 * approached by walking `-d`. Always exactly `forward.landing` (the cell
 * `forward` lands its own walker on), which is what makes "down, then
 * the reverse input" a real round trip rather than a coincidence. */
export function reverseOpenNeighbor(pairing: TransitionPairing): {
  readonly cell: { readonly x: number; readonly y: number };
  readonly direction: UnitStep;
} {
  const { reverse, d } = pairing;
  return {
    cell: { x: reverse.x + d.x, y: reverse.y + d.y },
    direction: { x: -d.x, y: -d.y },
  };
}

/** The three neighbours of `anchor`, on its own floor, that must each
 * refuse a step into it -- every axis-aligned neighbour except the one
 * `openDirection` names (story 15.2, Quentin's finding 1: "a stairwell has
 * one top and one bottom, so the anchor must be enterable from exactly one
 * side"). */
export function blockedNeighborsOf(
  anchor: { readonly x: number; readonly y: number },
  openDirection: UnitStep,
): readonly { readonly x: number; readonly y: number }[] {
  const perp: UnitStep = { x: -openDirection.y, y: openDirection.x };
  return [
    { x: anchor.x + openDirection.x, y: anchor.y + openDirection.y },
    { x: anchor.x + perp.x, y: anchor.y + perp.y },
    { x: anchor.x - perp.x, y: anchor.y - perp.y },
  ];
}

/**
 * Every problem with `transitions`' own pair symmetry, as a list (empty
 * means every transition mirrors a real reverse, one to one) --
 * `checkWorldSpec`'s own idiom, so a caller sees everything wrong at once
 * rather than only the first. The pairing half is pure (no grid) and
 * always runs; the standability half -- both cells a pairing's own
 * `reverse` introduces must be standable for the real body -- only runs
 * when `isStandable` is supplied (story 15.2, Quentin's finding 5): a
 * caller with no grid handy (a pure data check) still gets the pairing
 * check, and a caller that does have one gets both.
 */
export function checkTransitionPairSymmetry(
  transitions: readonly TransitionSpec[],
  isStandable?: TransitionStandable,
): string[] {
  const { pairings, unpaired } = pairTransitions(transitions);
  const problems: string[] = [];

  for (const forward of unpaired) {
    problems.push(
      `transition (${forward.x}, ${forward.y}, floor ${forward.floor}) -> ` +
        `(${forward.targetX}, ${forward.targetY}, floor ${forward.targetFloor}) has no ` +
        "mirrored reverse transition in the same list",
    );
  }

  if (isStandable) {
    for (const { forward, reverse } of pairings) {
      const where = `transition (${forward.x}, ${forward.y}, floor ${forward.floor}) -> (${forward.targetX}, ${forward.targetY}, floor ${forward.targetFloor})`;
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
   * Pair symmetry (story 15.2, Quentin's direction, finding 5) is the
   * *default*, not an opt-in: the pairing half of
   * [`checkTransitionPairSymmetry`] is pure (no grid needed) and runs on
   * every construction, so a subscription that hands this class real
   * transitions is checked the same way the committed street's own
   * fixture is -- the guard is never dark in production. The standability
   * half runs too when `isStandable` is supplied. `skipPairSymmetry` is
   * the named, visible escape hatch `world/floor-walk.test.ts`'s own
   * "mutually-targeting pair" fixture uses: it deliberately constructs the
   * exact shape `sim::world::WorldSpec::build` itself does not reject (two
   * transitions targeting each other's own identical anchor cell) to
   * prove `stepAndTransition`'s edge-triggered gating alone never bounces
   * on it, and pairing that shape (`d` would have to be the zero vector)
   * can never succeed -- the lenient path is a visible choice in that one
   * test file, never a silent default in `world/`. */
  constructor(
    transitions: readonly TransitionSpec[],
    options?: {
      readonly isStandable?: TransitionStandable;
      readonly skipPairSymmetry?: true;
    },
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

    if (!options?.skipPairSymmetry) {
      const problems = checkTransitionPairSymmetry(transitions, options?.isStandable);
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
