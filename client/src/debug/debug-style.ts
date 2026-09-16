// FR168's "deliberately non-diegetic style", as data rather than taste
// (Quentin's direction, story 1.12): one palette, one font, one stroke
// width, in one place -- so "is this overlay distinguishable from the
// game?" is a question `overlay-conformance.ts` answers mechanically
// against every registered overlay, instead of one a reviewer answers by
// eye once and never again.
//
// Nothing here could pass for LimeZu pixel art: fully saturated primaries
// at maximum value, hairline strokes, and a UI monospace face the tileset
// contains no equivalent of. `ModernTileset/` is muted and mid-value
// throughout; these are not.

/** Every colour, size and opacity any overlay is allowed to draw with.
 * An overlay that wants a new colour adds it here, where the conformance
 * suite can see it -- never inline at a draw site. */
export const DEBUG_STYLE = {
  /** Sizes are in *world* pixels: the overlay's own root group carries
   * the scene's zoom, so a label scales with the world exactly as a
   * sprite does, and a tile is always `render.tile_size_px` across. */
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSizePx: 4,
  lineHeightPx: 4.5,
  /** Always paired with `vector-effect: non-scaling-stroke`, so a
   * hairline stays a hairline at any zoom instead of growing into a band
   * that hides what it is measuring. */
  strokeWidthPx: 1,
  /** A real collider's fill: present enough to read as a solid area, far
   * too translucent to be mistaken for art. */
  fillOpacity: 0.25,
  /** The dash pattern the "no collider at all" outline is drawn with --
   * a second, shape-level difference on top of the colour one, so the
   * three collider states stay distinguishable to a colour-blind reader
   * too. */
  dashArray: "2 2",
  palette: {
    /** A real, area-having collider (FR128: this is what blocks a step). */
    collider: "#ff00ff",
    /** A collider declared with no area -- blocks nothing, but is not
     * absent. */
    emptyCollider: "#ffff00",
    /** No collider declared at all: FR128's walkability. */
    noCollider: "#00ffff",
    /** The FR123 sort key readout. */
    sortLabel: "#00ffff",
    /** The halo every label is painted under, so a readout stays legible
     * over any sprite beneath it. */
    labelHalo: "#000000",
  },
} as const;

/** Every colour the palette above declares -- what
 * `overlay-conformance.ts` checks a drawn overlay's own attributes
 * against. */
export const DEBUG_PALETTE: readonly string[] = Object.values(DEBUG_STYLE.palette);
