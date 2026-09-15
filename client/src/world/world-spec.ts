// The client's own mirror of `sim::world::WorldSpec::build`'s refusals
// (NFR30 forbids sharing the code): world data -- hand-laid today
// (`test-street/fixture.ts`), streamed from `building_area`/`room_area`/
// `floor_transition` rows tomorrow -- is checked before anything consumes
// it, so a bad world fails a fast test rather than only failing when
// somebody walks it.
//
// `world/**` rules apply: no `pixi.js`, no DOM, no `net/` beyond
// `net/bindings` types.

import { chunkKey } from "./chunk";
import type { OwnershipArea, OwnershipRect } from "./ownership";
import type { TransitionSpec } from "./transitions";

function rectIsValid(rect: OwnershipRect): boolean {
  return rect.x1 > rect.x0 && rect.y1 > rect.y0;
}

function rectsOverlap(a: OwnershipRect, b: OwnershipRect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Whether `rect` lies entirely inside the one chunk its own anchor
 * corner names -- the containment rule an ownership row must satisfy
 * (`sim::world::rect_is_within_one_chunk`), checked by comparing the
 * chunk key of all four corners. An invalid rect is never within one
 * chunk. */
export function rectIsWithinOneChunk(rect: OwnershipRect, floor: number): boolean {
  if (!rectIsValid(rect)) return false;
  const key = chunkKey(rect.x0, rect.y0, floor);
  return (
    chunkKey(rect.x1 - 1, rect.y0, floor) === key &&
    chunkKey(rect.x0, rect.y1 - 1, floor) === key &&
    chunkKey(rect.x1 - 1, rect.y1 - 1, floor) === key
  );
}

export interface WorldSpecCheck {
  readonly buildingAreas: readonly OwnershipArea[];
  readonly roomAreas: readonly OwnershipArea[];
  readonly transitions: readonly TransitionSpec[];
  /** Whether a whole cell can be stood on, on its own floor -- supplied
   * by the caller, because standability is the collision grid's answer
   * (`world/collision-grid.ts` plus the player body from
   * `defs/balance/movement.toml`), never this module's own rule. */
  readonly isStandable: (x: number, y: number, floor: number) => boolean;
  /** Which chunk a caller's own row declares an area filed under.
   * Defaults to the real key (the rect's own anchor corner), so most
   * callers never supply this; it exists only so a caller carrying real
   * `building_area` rows can pass the *declared* `chunk_key` column those
   * rows actually carry. That declared value is never trusted on its own
   * (Tim's direction, cycle 1): `checkWorldSpec` always checks it against
   * the real key too, and reports a problem when they disagree -- the
   * same refusal `WorldSpec::build` makes for a row whose own
   * `chunk_key` column lies about which chunk its rect anchors in. A
   * caller cannot use this to make the mirror accept what the oracle
   * would refuse. */
  readonly chunkKeyOf?: (area: OwnershipArea) => bigint;
}

function checkAreas(
  areas: readonly OwnershipArea[],
  kind: string,
  chunkKeyOf: (area: OwnershipArea) => bigint,
  problems: string[],
): void {
  const byChunk = new Map<bigint, OwnershipArea[]>();
  for (const area of areas) {
    const { rect, floor } = area;
    const where = `${kind} (${rect.x0}, ${rect.y0})-(${rect.x1}, ${rect.y1}) on floor ${floor}`;
    if (!rectIsValid(rect)) {
      problems.push(`${where} is invalid`);
      continue;
    }
    if (!rectIsWithinOneChunk(rect, floor)) {
      problems.push(`${where} spans more than one chunk`);
      continue;
    }
    const realKey = chunkKey(rect.x0, rect.y0, floor);
    const declaredKey = chunkKeyOf(area);
    if (declaredKey !== realKey) {
      problems.push(
        `${where} declares chunk_key ${declaredKey}, but its own chunk_key is ${realKey}`,
      );
      continue;
    }
    const key = declaredKey;
    const bucket = byChunk.get(key);
    if (!bucket) {
      byChunk.set(key, [area]);
      continue;
    }
    // Only same-floor rects can overlap in a meaningful sense, and a
    // chunk key already carries the floor -- two areas in one bucket are
    // on the same floor by construction.
    const clash = bucket.find((other) => rectsOverlap(other.rect, rect));
    if (clash) {
      problems.push(`${where} overlaps another ${kind} in the same chunk`);
      continue;
    }
    bucket.push(area);
  }
}

/**
 * Every rule `WorldSpec::build` refuses a world for, as a list of
 * problems (empty means the world is legal). Returns them all rather than
 * throwing on the first, so one run names everything wrong with a
 * hand-laid street:
 *
 * - an invalid ownership rect, or one that does not fit inside the single
 *   chunk its own anchor corner names;
 * - an area whose declared `chunk_key` (`chunkKeyOf`, when a caller
 *   supplies real rows) disagrees with the real key its own rect anchors
 *   in;
 * - two areas of the same kind, in the same chunk, whose rects overlap --
 *   which one a query answers with would otherwise depend on row order;
 * - a transition whose anchor or target cell is not standable on its own
 *   declared floor.
 */
export function checkWorldSpec(check: WorldSpecCheck): string[] {
  const { buildingAreas, roomAreas, transitions, isStandable } = check;
  const chunkKeyOf =
    check.chunkKeyOf ?? ((area) => chunkKey(area.rect.x0, area.rect.y0, area.floor));
  const problems: string[] = [];

  checkAreas(buildingAreas, "building_area", chunkKeyOf, problems);
  checkAreas(roomAreas, "room_area", chunkKeyOf, problems);

  for (const t of transitions) {
    if (!isStandable(t.x, t.y, t.floor)) {
      problems.push(`transition anchor (${t.x}, ${t.y}, floor ${t.floor}) is not standable`);
    }
    if (!isStandable(t.targetX, t.targetY, t.targetFloor)) {
      problems.push(
        `transition target (${t.targetX}, ${t.targetY}, floor ${t.targetFloor}) is not standable`,
      );
    }
  }

  return problems;
}
