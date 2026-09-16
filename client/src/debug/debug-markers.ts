// The `data-bc-debug` values the overlay *surface* itself uses, declared
// once (story 1.12, cycle 2 -- Quentin's direction).
//
// `overlays.ts` puts these on the root `<svg>` and on the camera group;
// every other `data-bc-debug` on the page is an overlay's own id. The two
// namespaces share one attribute, so an overlay registered later as `view`
// would pass `ID_PATTERN` and then silently resolve to the camera group --
// the failure surfacing as a baffling "has a group on the page while
// disabled" from the conformance suite rather than as the registry
// refusing it. `DebugOverlayRegistry` therefore refuses these ids up
// front, reading them from here rather than restating them: one
// definition, two consumers, and no way for the two to drift.
//
// This module exists (rather than the constants living in `overlays.ts`)
// only because the registry cannot import the mount -- the mount imports
// the registry.

/** The root `<svg>` the overlays are drawn into. */
export const DEBUG_ROOT_MARKER = "overlays";

/** The one group carrying the scene's camera transform. */
export const DEBUG_VIEW_MARKER = "view";

/** Ids no overlay may register under, because the surface already uses
 * them for something that is not an overlay. */
export const RESERVED_OVERLAY_IDS: readonly string[] = [DEBUG_ROOT_MARKER, DEBUG_VIEW_MARKER];
