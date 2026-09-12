// The story 1.6 demo scene's committed depth order (Quentin's direction):
// shared verbatim by `drawables.test.ts` (which sorts the fixture
// through the comparator directly, in vitest's node environment) and
// `../e2e/render-order.spec.ts` (which reads the same order back out of
// a real mounted Pixi display list through `window.__bc`) -- so the
// comparator and the real adapter can never silently disagree about what
// this scene renders. Decimal strings, matching `window.__bc.renderOrder`
// (`bigint` does not survive Playwright's page-to-Node serialisation).
//
// Every wall column (rank 30) sorts before the window/poster mounted on
// it (rank 40), because rank outranks x once y ties; the ground- and
// upper-storey north walls interleave column by column since they share
// every (x, y) and only their stableId (1 < 12) breaks the tie. See
// `drawables.test.ts` for the worked-example assertions this list
// summarises.
export const DEMO_SCENE_GOLDEN_ORDER: readonly string[] = [
  "1",
  "12", // north wall x=3, ground then upper storey
  "1",
  "12", // x=4
  "1",
  "12", // x=5
  "1",
  "12", // x=6
  "1",
  "12", // x=7
  "1",
  "12", // x=8
  "6", // window -- rank 40, after every rank-30 wall cell on that row
  "7", // poster -- rank 40, same reason
  "8", // counter, x=4
  "8", // counter, x=5
  "8", // counter, x=6
  "4", // west wall, y=2 -- the far end of the near/far worked example
  "5", // east wall, y=2
  "4", // west wall, y=3
  "5", // east wall, y=3
  "13", // upper-storey table (world y=4, same tier as the row below, lower rank)
  "4", // west wall, y=4 -- ties the player's own row; rank breaks it (wall behind)
  "5", // east wall, y=4
  "1000", // the player itself
  "9", // table, y=5
  "10", // glass, y=5 -- rank 20, after the rank-10 table it shares an anchor with
  "4", // west wall, y=5 -- the near end, in front of the player
  "5", // east wall, y=5
  "11", // awning (door lintel)
  "2", // south wall, west segment, x=3
  "2", // south wall, west segment, x=4
  "3", // south wall, east segment, x=6
  "3", // south wall, east segment, x=7
  "3", // south wall, east segment, x=8
];

/**
 * The order after the player has walked south to the edge of
 * `PLAYER_BOUNDS` (y = 5.8, clamped -- a deterministic endpoint
 * regardless of exact key-hold timing): they now sort in front of the
 * table, the glass and the whole near row of the west/east walls, which
 * all sorted behind them at the start position. `drawables.test.ts`
 * asserts this same list directly against the comparator
 * (`sortDrawablesInPlace`) -- `render-order.spec.ts` only proves the real
 * adapter reaches the identical order after a real keyboard move, it
 * never owns the ordering fact by itself.
 */
export const DEMO_SCENE_GOLDEN_ORDER_AFTER_WALKING_SOUTH: readonly string[] = [
  "1",
  "12",
  "1",
  "12",
  "1",
  "12",
  "1",
  "12",
  "1",
  "12",
  "1",
  "12",
  "6",
  "7",
  "8",
  "8",
  "8",
  "4",
  "5",
  "4",
  "5",
  "13",
  "4",
  "5",
  "9", // table -- now behind the player
  "10", // glass -- now behind the player
  "4", // west wall, y=5 -- now behind the player too
  "5", // east wall, y=5
  "1000", // the player, now past the near row
  "11", // awning -- still in front of the player
  "2",
  "2",
  "3",
  "3",
  "3",
];
