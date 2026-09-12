// The story 1.6 demo scene's committed depth order (Quentin's direction):
// shared verbatim by `demo-scene.test.ts` (which sorts the fixture
// through the comparator directly, in vitest's node environment) and
// `../e2e/render-order.spec.ts` (which reads the same order back out of
// a real mounted Pixi display list through `window.__bc`) -- so the
// comparator and the real adapter can never silently disagree about what
// this scene renders. Decimal strings, matching `window.__bc.renderOrder`
// (`bigint` does not survive Playwright's page-to-Node serialisation).
//
// Every wall column (rank 30) sorts before the window/poster mounted on
// it (rank 40), because rank outranks x once y ties; the ground- and
// upper-storey walls interleave column by column since they share every
// (x, y) and only their stableId (1 < 8) breaks the tie. See
// `demo-scene.test.ts` for the worked-example assertions this list
// summarises.
export const DEMO_SCENE_GOLDEN_ORDER: readonly string[] = [
  "1",
  "8", // wall column x=2, ground then upper storey
  "1",
  "8", // x=3
  "1",
  "8", // x=4
  "1",
  "8", // x=5
  "1",
  "8", // x=6
  "1",
  "8", // x=7
  "1",
  "8", // x=8
  "1",
  "8", // x=9
  "2", // window -- rank 40, after every rank-30 wall cell on that row
  "3", // poster -- rank 40, same reason
  "4", // counter cell (6,2), the far end -- behind the player
  "4", // counter cell (6,3), the same row as the player
  "9", // upper-storey table, same (x, y, rank) as the cell above, tiebroken by stableId
  "1000", // the player itself
  "5", // table (3,4)
  "4", // counter cell (6,4), the near end -- in front of the player
  "6", // glass (3,4) -- rank 20, after the rank-10 table it shares an anchor with
  "7", // awning (5,5)
];
