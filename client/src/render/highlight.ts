// FR173's affordance mark, promoted out of `test-street/scene.ts` into a
// permanent module (Tim/Quentin's direction, story 1.15): the pure half of
// the mark, in the same split `visibility.ts`/`pixi-visibility.ts` already
// established. Zero PixiJS -- every field below is a plain number or a
// caller-supplied texture handle, so the whole grammar is provable in
// vitest with no mounted `Application`. `render/pixi-highlight.ts` is the
// only place this turns into a real overlay `Sprite`.
//
// Why an affordance is allowed to exist here at all (Derek's direction):
// this city is 16x16 pixel art at 3x zoom, procedurally dense with props,
// with no HUD, no marker and no tutorial to disambiguate which handful of
// dozens of drawn objects is interactable. Without a mark a player cannot
// tell the till from the poster behind it, and that is not a difficulty
// curve, it is an inability to find the game (`docs/ux.md` §1). That is
// the whole licence this module has: one additive brighten of a single
// hovered, in-reach object's own drawables, nothing else, and never a
// general "highlight things" layer.
//
// The grammar (FR173), restated as the four cells a hover/reach truth
// table crosses:
//   - hovered, in reach: marked -- every drawable of that object gets an
//     overlay.
//   - hovered, out of reach: cursor only. Never a dimmed or weakened
//     variant -- the *absence* of the mark is what teaches "not from
//     here", and a weak version of it destroys that signal (Artie's
//     direction).
//   - not hovered, in reach: nothing. The world is never pre-lit.
//   - not hovered, out of reach: nothing.
// Exactly one object is ever marked, and the mark never persists once the
// pointer moves on: it is built on hover and destroyed on un-hover, never
// state the world holds (D17).

/** The four Pixi blend modes that are renderer-native in Pixi v8 and need
 * no filter pass -- `scripts/ci/check-no-masks.sh` holds every
 * `blendMode` assignment under `client/src/` to this set literally, so
 * the "a blend mode is not a filter" claim below is true by construction,
 * not by review discipline (Tim's direction). */
export const BASIC_BLEND_MODES = ["normal", "add", "multiply", "screen"] as const;
export type BasicBlendMode = (typeof BASIC_BLEND_MODES)[number];

/** Additive blending brightens the object's own opaque pixels neutrally;
 * a tint can only multiply, which reads as stained rather than lit and
 * would carry the state change in hue alone, which the accessibility
 * floor forbids (Artie's direction). A blend mode is not a filter, so
 * FR121's mask/filter ban is untouched. */
export const HIGHLIGHT_BLEND_MODE: BasicBlendMode = "add";

/**
 * The alpha one highlight overlay draws at: `ceilingAlpha` (the resolved
 * `render.highlight_alpha` balance value, a plain `(0, 1)` fraction --
 * never a literal in this module) scaled by the U1 display-strength dial
 * (`strength`, 0-100, percent -- the options menu's own slider range is
 * the narrower `[20, 100]`, enforced by `settings/display-settings.ts`,
 * not restated here) and by the source sprite's own current alpha, so a
 * translucent source (a window's furniture seen through the glass) never
 * ends up highlighted brighter than it is drawn. Monotone non-decreasing
 * in `strength`, and never exceeding `ceilingAlpha * sourceAlpha` --
 * `tests/unit/render/highlight.test.ts`'s property test pins both, for
 * every strength in `[0, 100]` and for junk input outside it.
 */
export function highlightOverlayAlpha(
  ceilingAlpha: number,
  strength: number,
  sourceAlpha: number,
): number {
  const clampedStrength = Number.isFinite(strength) ? Math.min(100, Math.max(0, strength)) : 0;
  return ceilingAlpha * (clampedStrength / 100) * sourceAlpha;
}

/** The minimal shape [`highlightOverlaySpec`] needs from a source sprite
 * -- structural over a texture handle of the caller's own choosing
 * (`render/pixi-highlight.ts`'s real `Texture`, or a plain string in a
 * unit test), so this module never imports `pixi.js` to describe it.
 * Deliberately no `visible` field: whether a source's own overlay exists
 * at all is `render/pixi-highlight.ts`'s own decision (built while the
 * source is visible, torn down the instant it is not), made before this
 * function is ever called -- a spec is only ever asked for once that
 * decision is already "yes". */
export interface HighlightSourceView<TTexture = unknown> {
  readonly texture: TTexture;
  readonly alpha: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Everything a caller needs to build or refresh one overlay sprite:
 * texture, anchor, position and scale copied straight from the source
 * (Artie's direction -- the overlay is not a snapshot, it must track its
 * source every frame it is alive), alpha computed through
 * [`highlightOverlayAlpha`], and the one basic blend mode this project
 * ever draws a highlight with. The insertion slot itself -- directly
 * above the source sprite, never a pool member, never a separate top
 * layer -- is a `Container` operation `render/pixi-highlight.ts` performs
 * and this module has no opinion on, since it never touches a display
 * list. */
export interface HighlightOverlaySpec<TTexture = unknown> {
  readonly texture: TTexture;
  readonly alpha: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly blendMode: BasicBlendMode;
}

/**
 * Builds the overlay spec for one source sprite of the hovered, in-reach
 * object -- everything [`highlightOverlayAlpha`] needs plus the rest of
 * the transform, mirrored straight from `source`.
 */
export function highlightOverlaySpec<TTexture>(
  source: HighlightSourceView<TTexture>,
  ceilingAlpha: number,
  strength: number,
): HighlightOverlaySpec<TTexture> {
  return {
    texture: source.texture,
    alpha: highlightOverlayAlpha(ceilingAlpha, strength, source.alpha),
    anchorX: source.anchorX,
    anchorY: source.anchorY,
    x: source.x,
    y: source.y,
    scaleX: source.scaleX,
    scaleY: source.scaleY,
    blendMode: HIGHLIGHT_BLEND_MODE,
  };
}
