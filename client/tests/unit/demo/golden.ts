// The demo scene's committed depth order (Quentin's direction): shared
// verbatim by `drawables.test.ts` (which sorts the fixture through the
// comparator directly, in vitest's node environment) and
// `../e2e/render-order.spec.ts` (which reads the same order back out of a
// real mounted Pixi display list through `window.__bc`) -- so the
// comparator and the real adapter can never silently disagree about what
// this scene renders. Decimal strings, matching `window.__bc.renderOrder`
// (`bigint` does not survive Playwright's page-to-Node serialisation).
//
// Story 1.7 regenerated this list from the real comparator
// (`buildPropDrawables`/`sortDrawablesInPlace`), not hand-derived --
// with the terrace, the subway platform (floor -1) and every FR120 wall
// stub added, hand-verifying ~80 entries by eye would itself be the
// error-prone step; the invariant tests already prove the comparator
// itself is correct (`inv_depth_order_total_and_stable`,
// `inv_floor_never_affects_depth_order`), so this file only has to state
// its real output as a committed fact, the same way it always has.
//
// Ids: 1/12 are shop A's ground/upper north wall; 30/60 are shop B's
// north wall and the platform's own north wall -- FR124 means floor never
// breaks a tie, so at x=13 (where shop B's own east end and the
// platform's own north-west corner share the same screen column) the two
// interleave, ordered only by stableId (30 before 60). 500000+ ids are
// the FR120 wall-stub companions (`demo/drawables.ts`'s `STUB_ID_OFFSET`)
// -- always present, drawn behind their own wall at the same cell.
export const DEMO_SCENE_GOLDEN_ORDER: readonly string[] = [
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
  "30",
  "30",
  "30",
  "30",
  "30",
  "60",
  "60",
  "60",
  "60",
  "60",
  "60",
  "60",
  "60",
  "7", // poster, north wall face
  "8",
  "8",
  "8", // shop A's counter
  "35",
  "35",
  "35", // shop B's counter
  "64",
  "64", // the platform bench
  "51", // the platform's own up-stairs decoration
  "4",
  "5",
  "34",
  "62",
  "63", // west/party/shop-B-east/platform-west/platform-east walls, y=2
  "4",
  "5",
  "34",
  "62",
  "63", // same wall set, y=3
  "13", // shop A's upper-storey table
  "4",
  "5",
  "34",
  "62",
  "63", // same wall set, y=4 -- the player's own row
  "1000", // the player, at rest in shop A
  "9", // shop A's table, right behind its window
  "36", // shop B's chair, right behind its window
  "10", // the glass on shop A's table
  "4",
  "5",
  "34",
  "62",
  "63", // same wall set, y=5 -- the near end, in front of the player
  "500002", // shop A front wall (west segment) stub, x=3
  "500002", // shop A front wall (west segment) stub, x=4
  "500006", // shop A's window stub
  "500003", // shop A front wall (east segment) stub, x=7
  "500003", // shop A front wall (east segment) stub, x=8
  "500031", // shop B front wall (west segment) stub
  "500032", // shop B's window stub
  "500033", // shop B front wall (east segment) stub, x=12
  "500033", // shop B front wall (east segment) stub, x=13
  "2",
  "2", // shop A front wall, west segment
  "6", // shop A's window
  "3",
  "3", // shop A front wall, east segment
  "31", // shop B front wall, west segment
  "32", // shop B's window
  "33",
  "33", // shop B front wall, east segment
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61", // the platform's own south wall
  "11", // the awning
  "14", // the lamppost obstacle
  "50", // the street-level subway stairwell prop, same row, further east
];

/**
 * The order after the player has walked south out shop A's door and
 * rested against the story 1.8 solid obstacle (id 14, a real collider):
 * identical to the at-rest order except the player itself (id 1000) now
 * sorts in front of everything else on the street -- Artie's cycle-3
 * direction carried forward: a player walking all the way out of the shop
 * must end up in front of everything, not hidden behind it forever.
 * `drawables.test.ts` asserts this same list directly against the
 * comparator -- `render-order.spec.ts` only proves the real adapter
 * reaches the identical order after a real keyboard move.
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
  "30",
  "30",
  "30",
  "30",
  "30",
  "60",
  "60",
  "60",
  "60",
  "60",
  "60",
  "60",
  "60",
  "7",
  "8",
  "8",
  "8",
  "35",
  "35",
  "35",
  "64",
  "64",
  "51",
  "4",
  "5",
  "34",
  "62",
  "63",
  "4",
  "5",
  "34",
  "62",
  "63",
  "13",
  "4",
  "5",
  "34",
  "62",
  "63",
  "9", // table -- now behind the player
  "36",
  "10", // glass -- now behind the player
  "4",
  "5",
  "34",
  "62",
  "63", // west/party/shop-B-east/platform walls, y=5 -- now behind the player too
  "500002",
  "500002",
  "500006",
  "500003",
  "500003",
  "500031",
  "500032",
  "500033",
  "500033",
  "2",
  "2", // south wall, west segment -- now behind the player
  "6",
  "3",
  "3",
  "31",
  "32",
  "33",
  "33",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "11", // awning -- now behind the player too: they have walked all the way past it
  "14", // the lamppost the player is now resting against -- also behind them
  "50",
  "1000", // the player, out on the pavement, in front of everything
];
