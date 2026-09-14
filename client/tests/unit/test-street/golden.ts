// The street scene's committed depth order (Quentin's direction): shared
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
// Ids: 1 is shop A's own north wall; 30/60 are shop B's north wall and
// the platform's own north wall -- FR124 means floor never breaks a tie,
// so at x=13 (where shop B's own east end and the platform's own
// north-west corner share the same screen column) the two interleave,
// ordered only by stableId (30 before 60). 40/41 are the two front-wall
// corner piers (story 1.7 cycle 2, Artie's direction): shop A's own,
// beside the party wall, and shop B's own, at its east wall -- each
// separates its shopfront's window from the corner, so the two never run
// straight into each other's glass. 500000+ ids are the FR120 wall-stub
// companions (`test-street/drawables.ts`'s `STUB_ID_OFFSET`) -- always present,
// drawn behind their own wall at the same cell, including the platform's
// own front wall (61 -> 500061), which retracts the same ownership-keyed
// way a shop's front wall does. There is no upper storey in this fixture
// (removed, story 1.7 cycle 2): `isStoreyAboveCulled` is proven directly
// against synthetic drawables in `visibility.test.ts`.
export const STREET_GOLDEN_ORDER: readonly string[] = [
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
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
  "8", // shop A's counter (3 cells wide)
  "35", // shop B's shelf
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
  "4",
  "5",
  "34",
  "62",
  "63", // same wall set, y=4 -- the player's own row
  "1000", // the player, at rest in shop A
  "9", // shop A's table, right behind its window
  "36", // shop B's basket, right behind its window
  "10", // the glass on shop A's table
  "4",
  "5",
  "34",
  "62",
  "63", // same wall set, y=5 -- the near end, in front of the player
  "500002", // shop A front wall (west segment) stub, x=3
  "500006", // shop A's window stub, x=5,6,7 (WINDOW_WIDTH = 3)
  "500006",
  "500006",
  "500040", // shop A's party-wall pier stub
  "500032", // shop B's window stub, x=10,11,12
  "500032",
  "500032",
  "500041", // shop B's east-wall pier stub
  "500061", // the platform's own front wall stub, x=13..20 (near-side, ownership-keyed)
  "500061",
  "500061",
  "500061",
  "500061",
  "500061",
  "500061",
  "500061",
  "2", // shop A front wall, west segment (the SW corner)
  "6", // shop A's window
  "6",
  "6",
  "40", // shop A's party-wall pier
  "32", // shop B's window
  "32",
  "32",
  "41", // shop B's east-wall pier
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61", // the platform's own south wall
  "11", // the awning
  "15", // story 1.9's trash bin, on the pavement east of the door
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
export const STREET_GOLDEN_ORDER_AFTER_WALKING_SOUTH: readonly string[] = [
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
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
  "500006",
  "500006",
  "500006",
  "500040",
  "500032",
  "500032",
  "500032",
  "500041",
  "500061",
  "500061",
  "500061",
  "500061",
  "500061",
  "500061",
  "500061",
  "500061",
  "2", // south wall, west segment -- now behind the player
  "6",
  "6",
  "6",
  "40",
  "32",
  "32",
  "32",
  "41",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "61",
  "11", // awning -- now behind the player too: they have walked all the way past it
  "15", // story 1.9's trash bin, on the pavement east of the door
  "14", // the lamppost the player is now resting against -- also behind them
  "50",
  "1000", // the player, out on the pavement, in front of everything
];

// --- FR120/FR121/FR122 visibility goldens (Quentin's direction, story
// 1.7 cycle 2): a decimal `stableId` -> state map for three fixed viewer
// positions, computed straight from `buildPropDrawables` +
// `computeVisibility` over the real street `OwnershipIndex`, exactly the
// way `scene.ts` resolves the viewer at runtime (`ownershipAt` on the
// player's own cell). `drawables.test.ts` asserts these directly against
// the pure functions; `../e2e/enclosure.spec.ts` imports the same maps
// and asserts them against `window.__bc.visibility`, which is built from
// each pool member's own real, just-written `sprite.visible`/
// `sprite.alpha` -- so the pure prediction and the real, mounted adapter
// can never silently disagree about what any of these three scenes show.
//
// The two front-wall corner-pier stubs (500040, 500041) are the cycle-2
// regression guard for the stub-shows-through-the-glass bug (Artie's
// finding): a stub is `normal` exactly when its own parent pier is
// retracted, `hidden` otherwise -- the inverse of every other drawable's
// own rule, never the same one. ---

/** The player at `PLAYER_START`, at rest inside shop A: shop A's own
 * near-side wall/window/pier (2, 6, 40) are retracted (hidden), so their
 * own stubs (500002, 500006, 500040) show; every subway drawable (floor
 * -1: 51, 60-64, 500061) is floor-culled; shop B's window (32) and pier
 * (41) are translucent/normal, not retracted, since the viewer is not
 * inside shop B -- so shop B's own stubs (500032, 500041) stay hidden. */
export const STREET_VISIBILITY_AT_REST_IN_SHOP_A: Readonly<Record<string, string>> = {
  "1": "normal",
  "2": "hidden", // shop A's own near-side wall -- retracted
  "4": "normal",
  "5": "normal",
  "6": "hidden", // shop A's own window -- retracted, not translucent (retraction wins)
  "7": "normal",
  "8": "normal",
  "9": "normal",
  "10": "normal",
  "11": "normal",
  "14": "normal",
  "30": "normal",
  "32": "translucent", // shop B's window -- the viewer is not inside shop B
  "34": "normal",
  "35": "normal",
  "36": "normal",
  "40": "hidden", // shop A's own party-wall pier -- retracted
  "41": "normal", // shop B's own east-wall pier -- not retracted
  "50": "normal",
  "51": "hidden", // floor -1 -- culled
  "60": "hidden",
  "61": "hidden",
  "62": "hidden",
  "63": "hidden",
  "64": "hidden",
  "1000": "normal", // the player itself
  "500002": "normal", // parent (2) retracted -- the stub shows
  "500006": "normal", // parent (6) retracted -- the stub shows
  "500032": "hidden", // parent (32) not retracted -- the stub stays hidden
  "500040": "normal", // parent (40) retracted -- the stub shows
  "500041": "hidden", // parent (41) not retracted -- the stub stays hidden
  "500061": "hidden", // floor -1 -- culled, same as its own wall
  "ground:0": "normal", // the street's own ground pass
  "ground:-1": "hidden", // the subway's own ground pass -- floor-culled
  "15": "normal",
};

/** The player at the lamppost rest point outside (`lamppostRestY()`), on
 * the pavement, `NO_OWNER`: nothing retracts (both shopfronts show a full
 * wall/translucent window/pier), so every stub stays hidden behind its
 * own parent; the subway stays floor-culled. */
export const STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE: Readonly<Record<string, string>> = {
  "1": "normal",
  "2": "normal",
  "4": "normal",
  "5": "normal",
  "6": "translucent",
  "7": "normal",
  "8": "normal",
  "9": "normal",
  "10": "normal",
  "11": "normal",
  "14": "normal",
  "30": "normal",
  "32": "translucent",
  "34": "normal",
  "35": "normal",
  "36": "normal",
  "40": "normal",
  "41": "normal",
  "50": "normal",
  "51": "hidden",
  "60": "hidden",
  "61": "hidden",
  "62": "hidden",
  "63": "hidden",
  "64": "hidden",
  "1000": "normal",
  "500002": "hidden",
  "500006": "hidden",
  "500032": "hidden",
  "500040": "hidden",
  "500041": "hidden",
  "500061": "hidden",
  "ground:0": "normal",
  "ground:-1": "hidden",
  "15": "normal",
};

/** The player just landed on the subway platform (`PLATFORM_LANDING_X +
 * 0.5, PLATFORM_LANDING_Y + 0.5`, floor -1): every street-side drawable
 * (floor 0) is floor-culled, and the platform's own near-side (front)
 * wall (61) retracts around the player the same ownership-keyed way a
 * shop's front wall does -- Artie's finding that the player was
 * invisible on the platform is exactly this state's own regression
 * guard: the player itself (1000) and the platform's own stub (500061)
 * must both stay `normal`. */
export const STREET_VISIBILITY_ON_SUBWAY_LANDING: Readonly<Record<string, string>> = {
  "1": "hidden",
  "2": "hidden",
  "4": "hidden",
  "5": "hidden",
  "6": "hidden",
  "7": "hidden",
  "8": "hidden",
  "9": "hidden",
  "10": "hidden",
  "11": "hidden",
  "14": "hidden",
  "30": "hidden",
  "32": "hidden",
  "34": "hidden",
  "35": "hidden",
  "36": "hidden",
  "40": "hidden",
  "41": "hidden",
  "50": "hidden",
  "51": "normal", // the platform's own up-stairs decoration
  "60": "normal", // the platform's own back wall
  "61": "hidden", // the platform's own near-side (front) wall -- retracted
  "62": "normal", // the platform's own west wall
  "63": "normal", // the platform's own east wall
  "64": "normal", // the platform bench
  "1000": "normal", // the player itself -- never hidden by its own enclosure's front wall
  "500002": "hidden",
  "500006": "hidden",
  "500032": "hidden",
  "500040": "hidden",
  "500041": "hidden",
  "500061": "normal", // the platform's own front-wall stub, left on screen while 61 is retracted
  "ground:0": "hidden", // the street's own ground pass -- floor-culled
  "ground:-1": "normal", // the subway's own ground pass
  "15": "hidden",
};
